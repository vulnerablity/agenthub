"""add organization avatar key

Revision ID: 20260929_0008
Revises: 20260922_0007
"""
from alembic import op
import sqlalchemy as sa

revision = "20260929_0008"
down_revision = "20260922_0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "organizations",
        sa.Column("avatar_key", sa.String(length=255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("organizations", "avatar_key")
