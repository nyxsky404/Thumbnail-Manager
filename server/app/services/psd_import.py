"""PSD → template import.

Pipeline
--------
1.  Open the .psd bytes with `psd_tools`.
2.  Composite the whole document with Photoshop's blend logic into a single
    RGBA PIL.Image. We deliberately do NOT try to re-render layers ourselves
    — `psd_tools.PSDImage.composite()` is the only way to get visuals that
    actually match what the user saw in Photoshop (blend modes, masks, layer
    effects, smart objects).
3.  Resize the composite into the chosen preset (contain-fit, centred on
    transparent padding) and re-encode as PNG. Compute the (scale, offset)
    transform so we can map text-layer coordinates from PSD space into our
    canvas space.
4.  Walk all layers recursively; for each text layer extract content, bbox,
    font family, weight, size, colour, alignment. Map them into our
    `TextElement` schema, applying the same transform.
5.  Diff text-layer fonts against a snapshot of the Google Fonts catalog.
    Anything we can't resolve becomes a `MissingFont` entry; the element's
    `fontFamily` is rewritten to "Roboto" so the editor renders something
    sensible while the user uploads a custom font.

Limitations (intentional, see docs/plans):
    * Non-text raster/vector/shape layers are baked into the background; the
      user can't move them after import.
    * Per-character styling is collapsed to the first style run — we don't
      support per-glyph fonts/colours in our editor anyway.
    * Italic / bold detection comes from the PostScript name suffix and the
      style-run flags; weight numbers are best-effort.
"""
from __future__ import annotations

import io
import logging
import re
import uuid
from dataclasses import dataclass
from typing import Any

from PIL import Image
from psd_tools import PSDImage

from ..schemas import MissingFont

logger = logging.getLogger(__name__)


@dataclass
class ParsedPsd:
    """Result of converting a .psd into our template model."""

    rendered_png: bytes
    text_elements: list[dict[str, Any]]
    missing_fonts: list[MissingFont]
    native_width: int
    native_height: int


# Maximum side-length we'll feed to PIL when contain-fit-resizing. Guards
# against absurd PSDs (e.g. 30,000 px wide) eating all RAM before we resize.
_MAX_INPUT_DIMENSION = 8192


# PostScript-name suffixes Photoshop appends to the family name. We strip
# them to recover the family + map to a CSS weight / italic flag.
# Order matters: longer suffixes first so "BoldItalic" wins over "Bold".
_WEIGHT_SUFFIXES: tuple[tuple[str, str, bool], ...] = (
    # (suffix lowercased, css weight, italic)
    ("blackitalic", "900", True),
    ("extraboldit", "800", True),
    ("extrabolditalic", "800", True),
    ("boldoblique", "700", True),
    ("bolditalic", "700", True),
    ("semiboldit", "600", True),
    ("semibolditalic", "600", True),
    ("mediumitalic", "500", True),
    ("regularitalic", "400", True),
    ("italic", "400", True),
    ("oblique", "400", True),
    ("lightitalic", "300", True),
    ("thinitalic", "100", True),
    ("extralight", "200", False),
    ("ultralight", "200", False),
    ("semibold", "600", False),
    ("demibold", "600", False),
    ("medium", "500", False),
    ("regular", "400", False),
    ("normal", "400", False),
    ("light", "300", False),
    ("thin", "100", False),
    ("hairline", "100", False),
    ("black", "900", False),
    ("heavy", "900", False),
    ("extrabold", "800", False),
    ("ultrabold", "800", False),
    ("bold", "700", False),
)


_PS_NAME_SPLIT_RE = re.compile(r"[-_,]+")


def _split_postscript_name(ps_name: str) -> tuple[str, str, bool]:
    """Split a PostScript font name into (family, css_weight, italic).

    Examples:
        HelveticaNeue-Bold        -> ("Helvetica Neue", "700", False)
        Helvetica-BoldOblique     -> ("Helvetica", "700", True)
        TradeGothic-LightOblique  -> ("Trade Gothic", "300", True)
        Roboto                    -> ("Roboto", "400", False)
    """
    parts = _PS_NAME_SPLIT_RE.split(ps_name) if ps_name else []
    if not parts:
        return "Roboto", "400", False

    family_raw = parts[0]
    suffix_raw = "".join(parts[1:]).lower() if len(parts) > 1 else ""

    weight = "400"
    italic = False
    if suffix_raw:
        for suf, w, it in _WEIGHT_SUFFIXES:
            if suf == suffix_raw or suffix_raw.endswith(suf):
                weight = w
                italic = it
                break

    family = _camel_to_spaces(family_raw)
    return family, weight, italic


def _camel_to_spaces(name: str) -> str:
    """Insert spaces at CamelCase boundaries so 'HelveticaNeue' -> 'Helvetica Neue'."""
    if not name:
        return name
    spaced = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", name)
    spaced = re.sub(r"(?<=[A-Z])(?=[A-Z][a-z])", " ", spaced)
    return spaced.strip()


def _normalise_family(name: str) -> str:
    """Match the normalisation in `app.api.google_fonts._normalise_family`."""
    return " ".join(name.lower().split())


def _argb_floats_to_hex(values: list[float] | tuple[float, ...]) -> str:
    """Photoshop fill colours are stored as 4 floats in 0..1 range, ARGB.

    We collapse to a `#RRGGBB` hex string (alpha is rarely useful for solid
    text fills and our schema's `color` is a CSS string anyway).
    """
    if not values or len(values) < 4:
        return "#FFFFFF"
    # values[0] is alpha, [1] R, [2] G, [3] B (per Photoshop spec).
    r = max(0, min(255, int(round(values[1] * 255))))
    g = max(0, min(255, int(round(values[2] * 255))))
    b = max(0, min(255, int(round(values[3] * 255))))
    return f"#{r:02X}{g:02X}{b:02X}"


def _extract_first_style(layer: Any) -> dict[str, Any]:
    """Return the first character-style record from a text layer's engine data.

    Photoshop stores per-glyph styling as an array of "style runs". We collapse
    everything to the first run because our editor model only supports a single
    style per text element.

    The engine-data shape varies between PSD versions: some files wrap the
    style sheet in a `RunData` dict, others put `StyleSheet` directly on the
    run entry. We walk both layouts.
    """
    try:
        engine = layer.engine_dict or {}
        style_run = engine.get("StyleRun", {})
        run_array = style_run.get("RunArray") or []
        if not run_array:
            return {}
        first = run_array[0]
        if not _isdictlike(first):
            return {}
        # Try the wrapped shape first, then the flat shape.
        sheet = None
        run_data = first.get("RunData")
        if _isdictlike(run_data):
            sheet = run_data.get("StyleSheet")
        if not _isdictlike(sheet):
            sheet = first.get("StyleSheet")
        if not _isdictlike(sheet):
            return {}
        ssd = sheet.get("StyleSheetData")
        return ssd if _isdictlike(ssd) else {}
    except Exception:  # noqa: BLE001 — engine_dict shape varies wildly
        return {}


def _isdictlike(x: Any) -> bool:
    """True if `x` supports `.get()` and key indexing — covers psd-tools' Dict
    wrapper class as well as plain dicts."""
    return x is not None and hasattr(x, "get") and hasattr(x, "__getitem__")


def _resolve_font_name(layer: Any, font_index: int) -> str:
    """Look up the PostScript name in the layer's resource FontSet.

    Falls back to "Roboto" if the resource is missing or the index is out of
    bounds — this lets the caller still produce a valid TextElement and flag
    the layer as needing a manual font assignment.
    """
    try:
        resource = layer.resource_dict or {}
        font_set = resource.get("FontSet") or []
        if 0 <= font_index < len(font_set):
            entry = font_set[font_index]
            # psd-tools returns its own Dict wrapper; use duck-typing rather
            # than isinstance(entry, dict) so we don't silently miss the name.
            raw = entry.get("Name") if _isdictlike(entry) else None
            # The value is psd-tools' `String` wrapper, not a Python str —
            # str() unwraps it. Skip "AdobeInvisFont" which Photoshop adds at
            # font-index 1 as a placeholder for invisible glyphs.
            if raw is not None:
                name = str(raw).strip().strip("'\"")
                if name and name != "AdobeInvisFont":
                    return name
    except Exception:  # noqa: BLE001
        pass
    return "Roboto"


def _extract_text_alignment(layer: Any) -> str:
    """0=left, 1=right, 2=center (per Photoshop). Default left.

    Like character styles, the paragraph-run shape varies: some PSDs wrap the
    `ParagraphSheet` in `RunData`, others put it directly on the run entry.
    """
    try:
        engine = layer.engine_dict or {}
        paragraph_run = engine.get("ParagraphRun", {})
        run_array = paragraph_run.get("RunArray") or []
        if not run_array:
            return "left"
        first = run_array[0]
        if not _isdictlike(first):
            return "left"
        sheet = None
        run_data = first.get("RunData")
        if _isdictlike(run_data):
            sheet = run_data.get("ParagraphSheet")
        if not _isdictlike(sheet):
            sheet = first.get("ParagraphSheet")
        if not _isdictlike(sheet):
            return "left"
        props = sheet.get("Properties")
        if not _isdictlike(props):
            return "left"
        justification = props.get("Justification") or 0
        return {0: "left", 1: "right", 2: "center"}.get(int(justification), "left")
    except Exception:  # noqa: BLE001
        return "left"


def parse_psd(
    body: bytes,
    target_w: int,
    target_h: int,
    known_families: set[str],
) -> ParsedPsd:
    """Parse `.psd` bytes and produce a template-ready bundle.

    `known_families` is the lower-cased set of Google Fonts family names from
    the catalog cache. Anything not in this set (and not user-uploadable
    later either) is recorded as a MissingFont. Pass an empty set to flag
    every PSD font as missing — the import still succeeds, just with more
    banners for the user.
    """
    try:
        psd = PSDImage.open(io.BytesIO(body))
    except Exception as e:  # noqa: BLE001 — psd-tools raises various exceptions
        logger.warning("PSD open failed: %s", e)
        raise ValueError("Could not parse PSD file") from e

    # If the PSD has artboards, treat the topmost visible artboard as the
    # entire design — Photoshop "save as PSD" of a multi-artboard doc stacks
    # them at z-order, and importers that bake the whole document together
    # get duplicated text, overlapping shapes, etc. Picking the top artboard
    # mirrors what the user sees when they open the file in Photoshop.
    artboards = [
        l for l in psd
        if getattr(l, "kind", None) == "artboard" and getattr(l, "visible", True)
    ]
    if artboards:
        # psd-tools iterates bottom→top, so the last entry is on top.
        root: Any = artboards[-1]
        ab_bbox = root.bbox  # (l, t, r, b) in document coords
        native_w = max(1, ab_bbox[2] - ab_bbox[0])
        native_h = max(1, ab_bbox[3] - ab_bbox[1])
        ab_offset = (ab_bbox[0], ab_bbox[1])
        if len(artboards) > 1:
            logger.info(
                "PSD has %d artboards; importing topmost %r (%dx%d)",
                len(artboards), root.name, native_w, native_h,
            )
    else:
        root = psd
        native_w, native_h = psd.width, psd.height
        ab_offset = (0, 0)

    if native_w <= 0 or native_h <= 0:
        raise ValueError("PSD reports zero dimensions")
    if native_w > _MAX_INPUT_DIMENSION or native_h > _MAX_INPUT_DIMENSION:
        raise ValueError(
            f"PSD is too large ({native_w}x{native_h}); max side {_MAX_INPUT_DIMENSION}px"
        )

    # 1. Composite at the document level with selected layers muted. We
    #    deliberately avoid `layer_filter=` because it breaks psd-tools'
    #    blend chain for PASS_THROUGH groups (the chevron's parent group);
    #    flipping `visible` and calling plain `composite()` walks the
    #    documented blend chain correctly.
    #
    #    What we mute:
    #      a) Text layers in the chosen artboard — re-emitted as editable
    #         overlays in step 4.
    #      b) Any non-chosen artboards — they're alternative designs.
    #      c) "Background fill" layers: shape / smart-object layers whose
    #         bbox covers most of the canvas. These are the artboard's
    #         solid background paths AND the imported background photo
    #         (PIC). Removing them yields a transparent bg PNG so the
    #         user can drop their own image underneath the editable
    #         frame elements (badges, chevrons, gradients, lines, text).
    canvas_area = max(1, native_w * native_h)
    bg_area_threshold = 0.80  # >=80% canvas → candidate for background

    def _is_bg_fill(lyr: Any) -> bool:
        """Heuristically classify a top-level layer as 'background photo / fill'.

        We're trying to strip *opaque background imagery* (the airshow photo,
        the hero portrait, white artboard fills) while keeping *decorative
        overlays* (gradient frames, brand graphics, badges) — even when the
        overlay's bbox happens to cover the full canvas.

        Rules, in order:
          * `kind == "shape"` covering ≥95% of canvas with solid fill → SKIP
            (artboard background-fill rectangles).
          * `kind == "pixel"` covering ≥80% → SKIP. Raster pixel layers at
            full-canvas size are nearly always photo backgrounds.
          * `kind == "smartobject"` covering ≥80% → SKIP only if its alpha
            channel is *mostly opaque* (mean alpha > 230/255). Decorative
            overlays are mostly transparent, so they fail this check and
            stay in the composite. Photo backgrounds (e.g. PIC in the
            other PSD) have alpha=255 everywhere and pass.
        """
        kind = getattr(lyr, "kind", None)
        if kind not in ("shape", "smartobject", "pixel"):
            return False
        bb = getattr(lyr, "bbox", None)
        if not bb or len(bb) != 4:
            return False
        # Use the *intersection* with the artboard so layers extending past
        # the doc edges (smart objects often do) are measured by their
        # contribution to the visible canvas, not their raw size.
        ix0 = max(bb[0], ab_offset[0])
        iy0 = max(bb[1], ab_offset[1])
        ix1 = min(bb[2], ab_offset[0] + native_w)
        iy1 = min(bb[3], ab_offset[1] + native_h)
        if ix1 <= ix0 or iy1 <= iy0:
            return False
        area = (ix1 - ix0) * (iy1 - iy0)
        coverage = area / canvas_area

        if kind == "shape":
            return coverage >= 0.95
        if kind == "pixel":
            return coverage >= bg_area_threshold
        # smartobject: also require mostly-opaque alpha so we don't strip
        # transparent decorative overlays.
        if coverage < bg_area_threshold:
            return False
        try:
            li = lyr.composite()
            if li is None or li.mode != "RGBA":
                return False
            alpha = li.split()[-1]
            # Use a coarse downsample to keep this cheap on huge PSDs.
            small = alpha.resize((64, 64))
            pixels = small.getdata()
            mean = sum(pixels) / max(1, len(pixels))
            return mean > 230  # ≥90% opaque on average
        except Exception:  # noqa: BLE001
            # If we can't sample the alpha, err on the side of *keeping* the
            # layer — false negatives are visible (a decorative overlay
            # vanishes), so prefer false positives (a bg layer survives).
            return False

    excluded: list[Any] = []
    excluded.extend(_iter_text_layers(root))
    # Walk the chosen artboard's *direct children only* for bg detection —
    # we don't want to descend into the chevron's smart-object child whose
    # bbox might also cover a lot relative to the canvas.
    bg_skipped: list[str] = []
    for child in root:
        if _is_bg_fill(child):
            excluded.append(child)
            bg_skipped.append(str(getattr(child, "name", "?")))
    if bg_skipped:
        logger.info("PSD import: skipping %d background layer(s): %s",
                    len(bg_skipped), ", ".join(bg_skipped))

    # Pass-through groups: psd-tools' aggdraw compositor mishandles
    # PASS_THROUGH groups when there's nothing (or only transparent pixels)
    # below them — it leaves a grey/white rectangular fill where the group's
    # internal canvas was. Workaround: mute these groups during the main
    # composite, then composite each one in isolation against transparency
    # and paste the result on top. Compositing a single group in isolation
    # gives correct alpha (verified: alpha extrema (0, 128) for the chevron's
    # 50%-opacity inner group).
    passthrough_groups: list[Any] = []
    for child in root:
        try:
            if child.is_group() and getattr(child, "blend_mode", None) and \
                    str(child.blend_mode).endswith("PASS_THROUGH"):
                # Only those NOT already muted as bg fills
                if child not in excluded:
                    passthrough_groups.append(child)
        except Exception:  # noqa: BLE001
            pass

    excluded.extend(passthrough_groups)

    if artboards:
        for ab_layer in artboards:
            if ab_layer is not root:
                excluded.append(ab_layer)

    saved_visibility: list[tuple[Any, bool]] = [
        (lyr, lyr.visible) for lyr in excluded
    ]
    for lyr in excluded:
        lyr.visible = False
    try:
        composite = psd.composite()
    except Exception as e:  # noqa: BLE001
        logger.warning("PSD composite failed: %s", e)
        raise ValueError("Could not render PSD composite") from e
    finally:
        for lyr, vis in saved_visibility:
            lyr.visible = vis

    if composite is None:
        raise ValueError("PSD has no visible layers to render")

    if composite.mode != "RGBA":
        composite = composite.convert("RGBA")

    # When compositing an artboard, psd-tools returns an image sized to the
    # artboard's bbox but its pixels are in document coords — crop to the
    # artboard rect so we don't carry padding from the doc origin.
    if composite.size != (native_w, native_h):
        try:
            composite = composite.crop((
                ab_offset[0],
                ab_offset[1],
                ab_offset[0] + native_w,
                ab_offset[1] + native_h,
            ))
        except Exception:  # noqa: BLE001
            # If crop fails (already correctly-sized image), proceed as-is.
            pass

    # 1b. Re-introduce pass-through groups by compositing each in isolation
    #     and alpha-pasting onto the main composite at its bbox. This keeps
    #     the group's correct alpha (verified against psd-tools) without
    #     triggering the doc-level pass-through rendering bug.
    for grp in passthrough_groups:
        try:
            grp_img = grp.composite()
        except Exception as e:  # noqa: BLE001
            logger.warning("Skipping pass-through group %r: %s",
                           getattr(grp, "name", "?"), e)
            continue
        if grp_img is None:
            continue
        if grp_img.mode != "RGBA":
            grp_img = grp_img.convert("RGBA")
        gb = grp.bbox
        if not gb or len(gb) != 4:
            continue
        # Group bbox is in document coords; subtract the artboard origin so
        # it lines up with the cropped composite.
        px = gb[0] - ab_offset[0]
        py = gb[1] - ab_offset[1]
        try:
            composite.alpha_composite(grp_img, dest=(px, py))
        except Exception as e:  # noqa: BLE001 — fall back to mask paste
            try:
                composite.paste(grp_img, (px, py), grp_img)
            except Exception:  # noqa: BLE001
                logger.warning("Could not paste pass-through group %r: %s",
                               getattr(grp, "name", "?"), e)

    # 2. Compute contain-fit transform from PSD coords -> canvas coords.
    scale = min(target_w / native_w, target_h / native_h)
    fitted_w = int(round(native_w * scale))
    fitted_h = int(round(native_h * scale))
    offset_x = (target_w - fitted_w) // 2
    offset_y = (target_h - fitted_h) // 2

    # 3. Build the canvas-sized PNG. Transparent padding lets the editor
    #    optionally show a background colour underneath later.
    canvas = Image.new("RGBA", (target_w, target_h), (0, 0, 0, 0))
    if scale != 1.0 or fitted_w != native_w or fitted_h != native_h:
        resized = composite.resize((fitted_w, fitted_h), Image.Resampling.LANCZOS)
    else:
        resized = composite
    canvas.paste(resized, (offset_x, offset_y), resized)

    buf = io.BytesIO()
    canvas.save(buf, format="PNG", optimize=True)
    rendered_png = buf.getvalue()

    # 4. Walk all layers (recursively descend into groups) and pick out text.
    text_elements: list[dict[str, Any]] = []
    missing_by_family: dict[str, MissingFont] = {}

    for layer in _iter_text_layers(root):
        try:
            element, family_for_lookup, weight = _layer_to_element(
                layer,
                scale=scale,
                offset_x=offset_x,
                offset_y=offset_y,
                canvas_w=target_w,
                canvas_h=target_h,
                psd_offset_x=ab_offset[0],
                psd_offset_y=ab_offset[1],
            )
        except Exception as e:  # noqa: BLE001 — never fail whole import on one bad layer
            logger.warning("Skipping unreadable text layer %r: %s", getattr(layer, "name", "?"), e)
            continue

        if family_for_lookup and _normalise_family(family_for_lookup) not in known_families:
            entry = missing_by_family.get(family_for_lookup)
            if entry is None:
                entry = MissingFont(
                    family=family_for_lookup,
                    weight=weight,
                    used_in_element_ids=[element["id"]],
                )
                missing_by_family[family_for_lookup] = entry
            else:
                entry.used_in_element_ids.append(element["id"])
            # Switch the element to a guaranteed-renderable family until the
            # user uploads a real one.
            element["fontFamily"] = "Roboto"

        text_elements.append(element)

    return ParsedPsd(
        rendered_png=rendered_png,
        text_elements=text_elements,
        missing_fonts=list(missing_by_family.values()),
        native_width=native_w,
        native_height=native_h,
    )


def _iter_text_layers(node: Any) -> Any:
    """Yield every *visible* text layer in document order, descending into groups.

    Hidden type layers represent design alternatives the user has parked —
    importing them produces phantom text on the canvas (see
    `LIVE_DESIGN 1`'s "15-POINT AGENDA" leaking into the live import).
    Hidden groups are skipped wholesale.
    """
    for layer in node:
        try:
            if not getattr(layer, "visible", True):
                continue
            if layer.is_group():
                yield from _iter_text_layers(layer)
                continue
            if getattr(layer, "kind", None) == "type":
                yield layer
        except Exception as e:  # noqa: BLE001
            logger.debug("Skipping layer during traversal: %s", e)


def _layer_to_element(
    layer: Any,
    *,
    scale: float,
    offset_x: int,
    offset_y: int,
    canvas_w: int,
    canvas_h: int,
    psd_offset_x: int = 0,
    psd_offset_y: int = 0,
) -> tuple[dict[str, Any], str, str]:
    """Convert a PSD text layer to our TextElement dict + return font lookup info.

    Returns (element_dict, original_family_name, css_weight). The original
    family name (PostScript-stripped) is what we feed to the missing-fonts
    diff; the dict already has `fontFamily` set to that value and the caller
    will swap it for "Roboto" if it's missing.
    """
    # Photoshop uses CR (\r) as the paragraph separator inside type layers;
    # Konva / HTML text rendering only break on \n, so normalise here.
    text = (layer.text or "").replace("\r\n", "\n").replace("\r", "\n")

    # Bounding box in PSD coordinates. Some layers report None if their bbox
    # isn't computable; default to a sensible block at the document origin.
    bbox = getattr(layer, "bbox", None)
    if bbox and len(bbox) == 4:
        l, t, r, b = bbox
    else:
        l, t, r, b = 0, 0, 400, 80

    # PSD bbox is in *document* coords; subtract the artboard origin first
    # so positions are relative to the cropped composite, then apply the
    # contain-fit transform. Clamp so a layer that extended past the PSD
    # bounds doesn't escape the canvas.
    al = l - psd_offset_x
    at = t - psd_offset_y
    ar = r - psd_offset_x
    ab = b - psd_offset_y
    cx = max(0.0, al * scale + offset_x)
    cy = max(0.0, at * scale + offset_y)
    cw = max(20.0, (ar - al) * scale)
    ch = max(20.0, (ab - at) * scale)
    if cx + cw > canvas_w:
        cw = max(20.0, canvas_w - cx)
    if cy + ch > canvas_h:
        ch = max(20.0, canvas_h - cy)

    # Style extraction — heavily defensive; engine data is undocumented and
    # changes between PSD versions / Photoshop releases.
    style = _extract_first_style(layer)
    font_idx = int(style.get("Font", 0) or 0)
    raw_font_size = float(style.get("FontSize", 24.0) or 24.0)
    fc = style.get("FillColor")
    fill_color = fc if _isdictlike(fc) else {}
    color_hex = _argb_floats_to_hex(fill_color.get("Values") or []) if fill_color else "#FFFFFF"
    leading = style.get("Leading")
    auto_leading = style.get("AutoLeading", True)
    tracking = float(style.get("Tracking", 0) or 0)
    underline = bool(style.get("Underline", False))
    strikethrough = bool(style.get("Strikethrough", False))
    faux_bold = bool(style.get("FauxBold", False))
    faux_italic = bool(style.get("FauxItalic", False))

    ps_name = _resolve_font_name(layer, font_idx)
    family, weight, italic = _split_postscript_name(ps_name)
    if faux_bold and weight in ("400", "300", "200", "100"):
        weight = "700"
    italic = italic or faux_italic

    # PSD `FontSize` is the *design* size — the headline text in a typical
    # PSD is stored as e.g. 24pt with a layer/text transform that scales it
    # up to its on-canvas size. We need that scale or text imports tiny.
    #
    # Strategy:
    #   a) Try `layer.transform` (Photoshop free-transform on the layer).
    #   b) If it's identity, derive scale from the rendered bbox height vs
    #      the expected design-space height — this recovers the Character-
    #      panel / type-tool transform that isn't surfaced as layer.transform.
    layer_scale = 1.0
    transform = getattr(layer, "transform", None)
    if isinstance(transform, (tuple, list)) and len(transform) >= 4:
        try:
            xx, xy = float(transform[0]), float(transform[1])
            tscale = (xx * xx + xy * xy) ** 0.5
            if tscale > 0.05 and abs(tscale - 1.0) > 0.01:
                layer_scale = tscale
        except (TypeError, ValueError):
            pass

    if layer_scale == 1.0 and bbox and len(bbox) == 4:
        # Bbox-derived fallback. Count lines using PSD's CR separator (\r),
        # plus newlines for safety. line_height factor matches the value
        # we emit for the element below.
        line_count = max(1, text.count("\r") + text.count("\n") + 1)
        lh_factor = 1.2
        if not auto_leading and leading:
            try:
                lh_factor = max(0.5, float(leading) / max(1.0, raw_font_size))
            except (TypeError, ValueError):
                pass
        bbox_h = max(1.0, float(bbox[3] - bbox[1]))
        design_h = max(1.0, raw_font_size * lh_factor * line_count)
        derived = bbox_h / design_h
        # Only trust the derived scale if it's plausibly an upscale — small
        # ratios usually mean the bbox is a tight glyph box, not a frame.
        if derived > 1.05:
            layer_scale = derived

    # Then apply the canvas contain-fit scale.
    font_size = max(4.0, raw_font_size * layer_scale * scale)

    align = _extract_text_alignment(layer)

    # `lineHeight` derivation. PSD's `Leading` is absolute; if absent, we
    # prefer to *recover* the actual line-height from the rendered glyph
    # bbox when the text has 2+ lines (Photoshop's auto-leading is usually
    # tighter than the CSS 1.2 default, and using 1.2 makes lines stack
    # too tall and overflow the imported frame). Single-line text falls
    # back to 1.2 because the bbox would only encode glyph ink, not leading.
    lines = text.split("\n") if text else [""]
    line_count = max(1, len(lines))
    bbox_h_canvas = ch  # set above from (b - t) * scale

    if not auto_leading and leading:
        try:
            line_height = max(0.5, float(leading) / max(1.0, raw_font_size))
        except (TypeError, ValueError):
            line_height = 1.2
    elif line_count >= 2 and font_size > 0 and bbox_h_canvas > 0:
        line_height = max(0.7, min(1.6, bbox_h_canvas / (line_count * font_size)))
    else:
        line_height = 1.2

    # Photoshop's `layer.bbox` is the *glyph ink* bounding box, not the text
    # frame. Importing those tight pixel bounds into Konva causes spurious
    # word-wrap (the last word of each line spills out by a few px and gets
    # pushed to the next line) and vertical clipping. Expand to a box that
    # comfortably fits the rendered text:
    #
    #   * width  = max(bbox_w + small horizontal padding, est. widest line)
    #   * height = lines × fontSize × derived lineHeight + small headroom
    #
    # then clamp so we never overflow the canvas. If the box wants to extend
    # past the canvas bottom, shift `y` up to keep all lines visible — the
    # user can drag it down again after import.
    longest = max((len(s) for s in lines), default=1)
    # Avg-char-width factor for bold sans-serif at the rendered fontSize:
    # Poppins Bold averages ~0.58em per char + 8% safety margin → 0.62.
    est_width_for_text = longest * font_size * 0.62
    desired_w = max(cw + font_size * 0.4, est_width_for_text)
    desired_h = max(
        ch + font_size * 0.2,
        line_count * font_size * line_height + font_size * 0.2,
    )
    cw = min(desired_w, max(20.0, canvas_w - cx))
    if cy + desired_h > canvas_h:
        # Pull the box up so the last line stays on canvas (common when
        # bottom-of-canvas headlines have descenders pushing past the edge).
        cy = max(0.0, canvas_h - desired_h)
    ch = min(desired_h, max(20.0, canvas_h - cy))

    element = {
        "id": uuid.uuid4().hex[:12],
        "text": text,
        "x": cx,
        "y": cy,
        "width": cw,
        "height": ch,
        "fontFamily": family or "Roboto",
        "fontWeight": weight,
        "fontSize": font_size,
        "lineHeight": line_height,
        "letterSpacing": tracking / 1000.0 * font_size,  # PSD tracking is per-1000em
        "color": color_hex,
        "align": align,
        "verticalAlign": "top",
        "italic": italic,
        "underline": underline,
        "lineThrough": strikethrough,
    }
    return element, family or "Roboto", weight


