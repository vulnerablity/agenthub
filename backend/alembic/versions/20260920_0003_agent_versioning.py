# migration 0003：重构 agents 表（对齐需求 4.4）并新增 agent_versions 表（对齐需求 4.5）
"""restructure agents per spec 4.4 and create agent_versions (spec 4.5)

Revision ID: 20260920_0003
Revises: 20260919_0002
Create Date: 2026-09-20
"""

import sqlalchemy as sa

from alembic import op

revision = "20260920_0003"
down_revision = "20260919_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. agent_versions 表（agent 删除级联清理版本；version 序号 agent 内唯一）
    op.create_table(
        "agent_versions",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("agent_id", sa.BigInteger(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("system_prompt", sa.Text(), nullable=False),
        sa.Column("model_provider", sa.String(length=50), nullable=False),
        sa.Column("model_name", sa.String(length=100), nullable=False),
        sa.Column("temperature", sa.Float(), nullable=True),
        sa.Column("max_tokens", sa.Integer(), nullable=True),
        sa.Column("config_json", sa.JSON(), nullable=True),
        sa.Column("created_by", sa.BigInteger(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["agent_id"], ["agents.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("agent_id", "version", name="uq_agent_version_seq"),
    )
    op.create_index("ix_agent_versions_agent_id", "agent_versions", ["agent_id"])

    # 2. agents 表：描述改 TEXT、补头像与当前版本字段、移除内嵌配置列
    op.alter_column(
        "agents",
        "description",
        existing_type=sa.String(length=500),
        type_=sa.Text(),
        existing_nullable=True,
    )
    op.add_column(
        "agents", sa.Column("avatar_url", sa.String(length=500), nullable=True)
    )
    op.add_column(
        "agents", sa.Column("current_version_id", sa.BigInteger(), nullable=True)
    )
    op.create_foreign_key(
        "fk_agents_current_version",
        "agents",
        "agent_versions",
        ["current_version_id"],
        ["id"],
        ondelete="SET NULL",
    )

    # 3. 存量数据回填：每个已有智能体将其配置快照为 v1 并设为当前版本（单一配置来源）
    op.execute(
        "INSERT INTO agent_versions "
        "(agent_id, version, system_prompt, model_provider, model_name, "
        " temperature, max_tokens, created_by) "
        "SELECT id, 1, system_prompt, provider, model, "
        "       temperature, max_tokens, created_by "
        "FROM agents"
    )
    op.execute(
        "UPDATE agents AS a "
        "JOIN agent_versions AS v ON v.agent_id = a.id "
        "SET a.current_version_id = v.id"
    )

    op.drop_column("agents", "system_prompt")
    op.drop_column("agents", "provider")
    op.drop_column("agents", "model")
    op.drop_column("agents", "temperature")
    op.drop_column("agents", "max_tokens")


def downgrade() -> None:
    op.add_column("agents", sa.Column("system_prompt", sa.Text(), nullable=True))
    op.add_column("agents", sa.Column("provider", sa.String(length=50), nullable=True))
    op.add_column("agents", sa.Column("model", sa.String(length=100), nullable=True))
    op.add_column("agents", sa.Column("temperature", sa.Numeric(3, 2), nullable=True))
    op.add_column("agents", sa.Column("max_tokens", sa.Integer(), nullable=True))
    op.drop_constraint("fk_agents_current_version", "agents", type_="foreignkey")
    op.drop_column("agents", "current_version_id")
    op.drop_column("agents", "avatar_url")
    op.alter_column(
        "agents",
        "description",
        existing_type=sa.Text(),
        type_=sa.String(length=500),
        existing_nullable=True,
    )
    op.drop_index("ix_agent_versions_agent_id", table_name="agent_versions")
    op.drop_table("agent_versions")
