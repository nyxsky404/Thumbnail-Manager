from uuid import uuid4

from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import relationship

from ..db import Base


class CustomFont(Base):
    __tablename__ = "custom_fonts"
    __table_args__ = (
        UniqueConstraint(
            "template_id", "family", "weight", name="uq_template_family_weight"
        ),
    )

    id = Column(String(36), primary_key=True, default=lambda: str(uuid4()))
    template_id = Column(
        String(36),
        ForeignKey("templates.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    family = Column(String(255), nullable=False)
    weight = Column(Integer, nullable=False, default=400)
    url = Column(Text, nullable=False)
    s3_key = Column(String(512), nullable=False)
    format = Column(String(8), nullable=False)  # "ttf" | "otf"
    created_at = Column(DateTime, nullable=False, server_default=func.now())

    template = relationship("Template", back_populates="custom_fonts")
