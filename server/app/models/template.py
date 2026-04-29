from datetime import datetime
from uuid import uuid4

from sqlalchemy import Boolean, Column, DateTime, Integer, String, Text, func
from sqlalchemy.dialects.mysql import JSON
from sqlalchemy.orm import relationship

from ..db import Base


class Template(Base):
    __tablename__ = "templates"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id = Column(String(64), nullable=False, default="default", index=True)
    name = Column(String(255), nullable=False)
    thumbnail_url = Column(Text, nullable=False)
    thumbnail_key = Column(String(512), nullable=False)
    preset = Column(String(8), nullable=False)  # "16:9" | "9:16"
    canvas_width = Column(Integer, nullable=False)
    canvas_height = Column(Integer, nullable=False)
    is_default = Column(Boolean, nullable=False, default=False, index=True)
    config_json = Column(JSON, nullable=False, default=lambda: {"elements": []})
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )

    custom_fonts = relationship(
        "CustomFont",
        back_populates="template",
        cascade="all, delete-orphan",
        order_by="CustomFont.created_at",
    )
