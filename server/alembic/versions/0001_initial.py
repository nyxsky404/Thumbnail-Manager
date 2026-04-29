"""initial schema

Revision ID: 0001
Revises:
Create Date: 2025-01-01 00:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "templates",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=64), nullable=False, server_default="default"),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("thumbnail_url", sa.Text(), nullable=False),
        sa.Column("thumbnail_key", sa.String(length=512), nullable=False),
        sa.Column("preset", sa.String(length=8), nullable=False),
        sa.Column("canvas_width", sa.Integer(), nullable=False),
        sa.Column("canvas_height", sa.Integer(), nullable=False),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("config_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_templates_user_id", "templates", ["user_id"])
    op.create_index("ix_templates_is_default", "templates", ["is_default"])

    op.create_table(
        "custom_fonts",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "template_id",
            sa.String(length=36),
            sa.ForeignKey("templates.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("family", sa.String(length=255), nullable=False),
        sa.Column("weight", sa.Integer(), nullable=False, server_default="400"),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("s3_key", sa.String(length=512), nullable=False),
        sa.Column("format", sa.String(length=8), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint(
            "template_id", "family", "weight", name="uq_template_family_weight"
        ),
    )
    op.create_index("ix_custom_fonts_template_id", "custom_fonts", ["template_id"])


def downgrade() -> None:
    op.drop_index("ix_custom_fonts_template_id", table_name="custom_fonts")
    op.drop_table("custom_fonts")
    op.drop_index("ix_templates_is_default", table_name="templates")
    op.drop_index("ix_templates_user_id", table_name="templates")
    op.drop_table("templates")
