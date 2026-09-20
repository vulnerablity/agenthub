# migration 0002：创建 agents 智能体表（组织作用域，名称组织内唯一）
"""create agents table

Revision ID: 20260919_0002
Revises: 20260918_0001
Create Date: 2026-09-19
"""

import sqlalchemy as sa

from alembic import op

revision = "20260919_0002"
down_revision = "20260918_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # agents 智能体表（system_prompt 为 TEXT：MySQL 不支持字面量默认值，由应用层保证非空）
    op.create_table(
        "agents",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("organization_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("description", sa.String(length=500), nullable=True),
        sa.Column("system_prompt", sa.Text(), nullable=False),
        sa.Column("provider", sa.String(length=50), nullable=False),
        sa.Column("model", sa.String(length=100), nullable=False),
        sa.Column("temperature", sa.Numeric(3, 2), nullable=True),
        sa.Column("max_tokens", sa.Integer(), nullable=True),
        sa.Column(
            "status", sa.String(length=20), server_default="enabled", nullable=False
        ),
        sa.Column("created_by", sa.BigInteger(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"]),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "name", name="uq_agent_name"),
    )
    op.create_index("ix_agents_organization_id", "agents", ["organization_id"])


def downgrade() -> None:
    op.drop_index("ix_agents_organization_id", table_name="agents")
    op.drop_table("agents")
