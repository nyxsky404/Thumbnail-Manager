import asyncio
import logging
from typing import List

from botocore.exceptions import ClientError
from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Request,
    Response,
    UploadFile,
    status,
)
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..api.google_fonts import get_known_families
from ..db import get_db
from ..models import CustomFont, Template
from ..schemas import (
    CanvasPreset,
    TemplateOut,
    TemplateUpdate,
)
from ..config import settings
from ..schemas.template import PRESET_DIMENSIONS
from ..services import s3
from ..services.psd_import import parse_psd
from ._uploads import read_with_limit

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/templates", tags=["templates"])

DEFAULT_USER_ID = "default"
MAX_PNG_SIZE = 10 * 1024 * 1024  # 10 MB
MAX_PSD_SIZE = 50 * 1024 * 1024  # 50 MB — PSDs are typically larger than PNGs

# Magic byte prefixes used to dispatch upload handling. We sniff bytes
# rather than trust `Content-Type` because browsers report `.psd` as
# `application/octet-stream`, `image/vnd.adobe.photoshop`, or even
# `image/x-photoshop` depending on OS/browser.
_PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
_PSD_MAGIC = b"8BPS"


def _proxy_thumbnail_url(template_id: str) -> str:
    return f"{settings.SERVER_BASE_URL}/api/templates/{template_id}/thumbnail"


def _proxy_font_url(template_id: str, font_id: str) -> str:
    return f"{settings.SERVER_BASE_URL}/api/templates/{template_id}/fonts/{font_id}/file"


def _to_out(t: Template) -> TemplateOut:
    out = TemplateOut.model_validate(t)
    # Rewrite URLs to point to the same-origin backend proxy so the browser
    # never has to do a cross-origin request to S3.
    out.thumbnail_url = _proxy_thumbnail_url(t.id)
    for font_out, font in zip(out.custom_fonts, t.custom_fonts):
        font_out.url = _proxy_font_url(t.id, font.id)
    return out


@router.get("", response_model=List[TemplateOut])
def list_templates(db: Session = Depends(get_db)):
    rows = (
        db.query(Template)
        .filter(Template.user_id == DEFAULT_USER_ID)
        # Pin the default template to the top of the grid; tie-break by
        # most-recently-updated so users land on what they touched last.
        .order_by(Template.is_default.desc(), Template.updated_at.desc())
        .all()
    )
    return [_to_out(t) for t in rows]


@router.get("/{template_id}", response_model=TemplateOut)
def get_template(template_id: str, db: Session = Depends(get_db)):
    t = db.query(Template).filter(Template.id == template_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Template not found")
    return _to_out(t)


@router.post("", response_model=TemplateOut, status_code=status.HTTP_201_CREATED)
async def create_template(
    request: Request,
    name: str = Form(..., min_length=1, max_length=255),
    preset: CanvasPreset = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """Create a template from either a PNG or a PSD upload.

    Dispatch is by magic bytes, not Content-Type — browsers spell PSD's
    MIME inconsistently. Both code paths produce the same `TemplateOut`
    response; the PSD path additionally populates `config_json.elements`
    with text layers extracted from the PSD and `config_json.missing_fonts`
    with anything that didn't match the Google Fonts catalog.
    """
    width, height = PRESET_DIMENSIONS[preset]

    # Peek the first 8 bytes to dispatch. We can't `await file.read()`
    # piecemeal then re-read in `read_with_limit`, so we read the whole
    # file with the larger of the two caps and then verify magic + size.
    body = await read_with_limit(file, MAX_PSD_SIZE)
    if len(body) < 8:
        raise HTTPException(status_code=400, detail="Uploaded file is too small")

    if body[:8] == _PNG_MAGIC:
        if len(body) > MAX_PNG_SIZE:
            raise HTTPException(status_code=400, detail="PNG must be <= 10 MB")
        rendered_png = body
        text_elements: list[dict] = []
        missing_fonts: list[dict] = []
    elif body[:4] == _PSD_MAGIC:
        try:
            client = request.app.state.http_client
            known = await get_known_families(client)
            parsed = await asyncio.to_thread(
                parse_psd, body, width, height, known
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:  # noqa: BLE001 — never bubble unparsed psd-tools errors
            logger.exception("Unexpected PSD parse failure")
            raise HTTPException(
                status_code=500,
                detail="Failed to import PSD; check server logs",
            ) from e
        rendered_png = parsed.rendered_png
        text_elements = parsed.text_elements[:20]
        missing_fonts = [mf.model_dump() for mf in parsed.missing_fonts]
    else:
        raise HTTPException(
            status_code=400,
            detail="File must be PNG (\\x89PNG\\r\\n\\x1a\\n) or PSD (8BPS)",
        )

    # Create row first to get id, then upload thumbnail under prefixed key.
    template = Template(
        user_id=DEFAULT_USER_ID,
        name=name,
        thumbnail_url="",
        thumbnail_key="",
        preset=preset.value,
        canvas_width=width,
        canvas_height=height,
        is_default=False,
        config_json={"elements": text_elements, "missing_fonts": missing_fonts},
    )
    db.add(template)
    db.flush()

    key = f"templates/{template.id}/thumbnail.png"
    url = await asyncio.to_thread(s3.upload_bytes, key, rendered_png, "image/png")
    template.thumbnail_url = url
    template.thumbnail_key = key
    db.commit()
    db.refresh(template)
    return _to_out(template)


@router.patch("/{template_id}", response_model=TemplateOut)
def update_template(
    template_id: str,
    payload: TemplateUpdate,
    db: Session = Depends(get_db),
):
    t = db.query(Template).filter(Template.id == template_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Template not found")

    if payload.name is not None:
        t.name = payload.name
    if payload.config is not None:
        # `mode="json"` returns a JSON-safe dict (datetimes -> strings, etc.)
        # without the str-serialise-then-parse round-trip the old code did.
        t.config_json = payload.config.model_dump(mode="json")

    db.commit()
    db.refresh(t)
    return _to_out(t)


@router.delete("/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_template(template_id: str, db: Session = Depends(get_db)):
    t = db.query(Template).filter(Template.id == template_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Template not found")

    was_default = t.is_default
    user_id = t.user_id
    template_id_str = t.id

    db.delete(t)
    db.flush()

    # Auto-promote a new default if needed
    if was_default:
        next_default = (
            db.query(Template)
            .filter(Template.user_id == user_id)
            .order_by(Template.updated_at.desc())
            .first()
        )
        if next_default:
            next_default.is_default = True

    db.commit()

    # Cleanup S3 (best-effort, after DB commit)
    s3.delete_prefix(f"templates/{template_id_str}/")
    return None


@router.post("/{template_id}/default", response_model=TemplateOut)
def set_default(template_id: str, db: Session = Depends(get_db)):
    t = db.query(Template).filter(Template.id == template_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Template not found")

    # Race-safe single-statement update
    db.execute(
        text(
            "UPDATE templates SET is_default = (id = :tid) WHERE user_id = :uid"
        ),
        {"tid": template_id, "uid": t.user_id},
    )
    db.commit()
    db.refresh(t)
    return _to_out(t)


@router.get("/{template_id}/thumbnail")
def proxy_thumbnail(template_id: str, db: Session = Depends(get_db)):
    """Stream the template's thumbnail PNG from S3 (same-origin proxy)."""
    t = db.query(Template).filter(Template.id == template_id).first()
    if not t or not t.thumbnail_key:
        raise HTTPException(status_code=404, detail="Thumbnail not found")
    try:
        body, content_type = s3.get_object(t.thumbnail_key)
    except ClientError as e:
        logger.warning("S3 fetch failed for %s: %s", t.thumbnail_key, e)
        raise HTTPException(status_code=502, detail="Failed to fetch thumbnail from S3")
    return Response(
        content=body,
        media_type=content_type,
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


@router.get("/{template_id}/fonts/{font_id}/file")
def proxy_font(template_id: str, font_id: str, db: Session = Depends(get_db)):
    """Stream a custom font file from S3 (same-origin proxy)."""
    font = (
        db.query(CustomFont)
        .filter(CustomFont.id == font_id, CustomFont.template_id == template_id)
        .first()
    )
    if not font:
        raise HTTPException(status_code=404, detail="Font not found")
    try:
        body, content_type = s3.get_object(font.s3_key)
    except ClientError as e:
        logger.warning("S3 fetch failed for %s: %s", font.s3_key, e)
        raise HTTPException(status_code=502, detail="Failed to fetch font from S3")
    return Response(
        content=body,
        media_type=content_type,
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )
