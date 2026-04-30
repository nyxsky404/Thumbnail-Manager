import asyncio
import logging

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import CustomFont, Template
from ..schemas import CustomFontOut
from ..services import s3
from ._uploads import read_with_limit

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/templates", tags=["fonts"])

MAX_FONT_SIZE = 2 * 1024 * 1024  # 2 MB

# Magic-byte signatures for TTF/OTF
# TTF: 00 01 00 00 OR "true" (Apple)
# OTF: "OTTO"
TTF_MAGICS = (b"\x00\x01\x00\x00", b"true")
OTF_MAGIC = b"OTTO"


def _detect_format(body: bytes) -> str | None:
    if len(body) < 4:
        return None
    head = body[:4]
    if head == OTF_MAGIC:
        return "otf"
    if head in TTF_MAGICS:
        return "ttf"
    return None


@router.post(
    "/{template_id}/fonts",
    response_model=CustomFontOut,
    status_code=status.HTTP_201_CREATED,
)
async def upload_font(
    template_id: str,
    family: str = Form(..., min_length=1, max_length=255),
    weight: int = Form(400, ge=100, le=900),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    template = db.query(Template).filter(Template.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    # Stream-read with an early bail-out so an oversized upload can't force
    # the server to buffer the full payload before we reject it.
    body = await read_with_limit(file, MAX_FONT_SIZE)

    fmt = _detect_format(body)
    if not fmt:
        raise HTTPException(
            status_code=400, detail="File is not a valid TTF or OTF font"
        )

    name_lower = (file.filename or "").lower()
    if fmt == "ttf" and not name_lower.endswith(".ttf"):
        raise HTTPException(status_code=400, detail="Extension must match font format")
    if fmt == "otf" and not name_lower.endswith(".otf"):
        raise HTTPException(status_code=400, detail="Extension must match font format")

    cf = CustomFont(
        template_id=template_id,
        family=family,
        weight=weight,
        url="",
        s3_key="",
        format=fmt,
    )
    db.add(cf)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="A font with this family and weight already exists for this template",
        )

    key = f"templates/{template_id}/fonts/{cf.id}.{fmt}"
    content_type = "font/otf" if fmt == "otf" else "font/ttf"
    url = await asyncio.to_thread(s3.upload_bytes, key, body, content_type)
    cf.url = url
    cf.s3_key = key
    db.commit()
    db.refresh(cf)
    out = CustomFontOut.model_validate(cf)
    # Same-origin relative URL (browser resolves against current page origin).
    out.url = f"/api/templates/{template_id}/fonts/{cf.id}/file"
    return out


@router.delete(
    "/{template_id}/fonts/{font_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_font(template_id: str, font_id: str, db: Session = Depends(get_db)):
    cf = (
        db.query(CustomFont)
        .filter(CustomFont.id == font_id, CustomFont.template_id == template_id)
        .first()
    )
    if not cf:
        raise HTTPException(status_code=404, detail="Font not found")

    s3_key = cf.s3_key
    db.delete(cf)
    db.commit()
    if s3_key:
        s3.delete_object(s3_key)
    return None
