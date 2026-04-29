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


class Shadow(BaseModel):
    color: str = Field(..., max_length=32)
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
    color: str = Field(..., max_length=32)
    backgroundColor: Optional[str] = Field(default=None, max_length=32)
    backgroundOpacity: Optional[float] = Field(default=None, ge=0, le=1)
    align: Literal["left", "center", "right"]
    verticalAlign: Literal["top", "middle", "bottom"]
    shadow: Optional[Shadow] = None


class ConfigPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    elements: List[TextElement] = Field(default_factory=list, max_length=20)


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
    user_id: str
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
