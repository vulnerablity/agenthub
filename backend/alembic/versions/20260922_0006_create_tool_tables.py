# migration 0006：新建 tool calling 模块两表（对齐需求 4.6 / 4.7，tool-calling.md 2.2）
"""create tool tables (spec 4.6 / 4.7, tool-calling.md)

Revision ID: 20260922_0006
Revises: 20260921_0005
Create Date: 2026-09-22
"""

import sqlalchemy as sa

from alembic import op

revision = "20260922_0006"
down_revision = "20260921_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. tools：组织作用域 + 名称组织内唯一（tool-calling.md D02）
    op.create_table(
        "tools",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("organization_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("type", sa.String(length=20), nullable=False),
        sa.Column("schema", sa.JSON(), nullable=False),
        sa.Column("config", sa.JSON(), nullable=True),
        sa.Column(
            "status", sa.String(length=20), server_default="active", nullable=False
        ),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
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
        sa.UniqueConstraint("organization_id", "name", name="uq_tool_name"),
    )
    op.create_index("ix_tools_organization_id", "tools", ["organization_id"])

    # 2. agent_tools：Agent/工具删除级联清理绑定（tool-calling.md D03/D04）
    op.create_table(
        "agent_tools",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("agent_id", sa.BigInteger(), nullable=False),
        sa.Column("tool_id", sa.BigInteger(), nullable=False),
        sa.Column("enabled", sa.Boolean(), server_default=sa.text("1"), nullable=False),
        sa.Column("config_json", sa.JSON(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["agent_id"], ["agents.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tool_id"], ["tools.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("agent_id", "tool_id", name="uq_agent_tool"),
    )
    op.create_index("ix_agent_tools_agent_id", "agent_tools", ["agent_id"])
    op.create_index("ix_agent_tools_tool_id", "agent_tools", ["tool_id"])


def downgrade() -> None:
    op.drop_index("ix_agent_tools_tool_id", table_name="agent_tools")
    op.drop_index("ix_agent_tools_agent_id", table_name="agent_tools")
    op.drop_table("agent_tools")
    op.drop_index("ix_tools_organization_id", table_name="tools")
    op.drop_table("tools")
