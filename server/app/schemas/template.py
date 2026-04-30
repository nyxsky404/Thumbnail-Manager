from datetime import datetime
from enum import Enum
from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class CanvasPreset(str, Enum):
    landscape = "16:9"
    portrait = "9:16"


PRESET_DIMENSIONS = {
    CanvasPreset.landscape: (1280, 720),
    CanvasPreset.portrait: (1080, 1920),
}


_CSS_COLOR_RE = r"^(#(?:[0-9A-Fa-f]{3,4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})|rgba?\([\d\s,./%]+\)|[a-zA-Z]{2,30})$"


class Shadow(BaseModel):
    color: str = Field(..., max_length=32, pattern=_CSS_COLOR_RE)
    x: float
    y: float
    blur: float = Field(..., ge=0)


class TextElement(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(..., min_length=1, max_length=64)
    text: str
    x: float
    y: float
    width: float = Field(..., gt=0)
    height: float = Field(..., gt=0)
    fontFamily: str = Field(..., min_length=1, max_length=255)
    fontWeight: str = Field(..., min_length=1, max_length=8)
    fontSize: float = Field(..., gt=0)
    lineHeight: float = Field(..., gt=0)
    letterSpacing: float
    color: str = Field(..., max_length=32, pattern=_CSS_COLOR_RE)
    backgroundColor: Optional[str] = Field(default=None, max_length=32, pattern=_CSS_COLOR_RE)
    backgroundOpacity: Optional[float] = Field(default=None, ge=0, le=1)
    align: Literal["left", "center", "right"]
    verticalAlign: Literal["top", "middle", "bottom"]
    italic: Optional[bool] = None
    underline: Optional[bool] = None
    lineThrough: Optional[bool] = None
    shadow: Optional[Shadow] = None
    textSizing: Optional[Literal["auto", "fixed"]] = None


class MissingFont(BaseModel):
    """A font referenced by an imported PSD that we couldn't resolve against
    the Google Fonts catalog. The frontend uses this to show a banner with
    'upload a custom font for X' actions; once the user uploads or dismisses,
    the entry is removed from `ConfigPayload.missing_fonts`."""

    model_config = ConfigDict(extra="forbid")
    family: str = Field(..., min_length=1, max_length=255)
    weight: str = Field(..., min_length=1, max_length=8)
    used_in_element_ids: List[str] = Field(default_factory=list, max_length=20)


class ConfigPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    elements: List[TextElement] = Field(default_factory=list, max_length=20)
    # Populated by the PSD-import path; empty for templates created from PNGs
    # or templates whose missing-font issues have all been resolved.
    missing_fonts: List[MissingFont] = Field(default_factory=list, max_length=20)


class TemplateCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    preset: CanvasPreset


class TemplateUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    config: Optional[ConfigPayload] = None


class CustomFontOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    family: str
    weight: int
    url: str
    format: str
    created_at: datetime


class TemplateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    name: str
    thumbnail_url: str
    preset: str
    canvas_width: int
    canvas_height: int
    is_default: bool
    config_json: dict
    custom_fonts: List[CustomFontOut] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime
