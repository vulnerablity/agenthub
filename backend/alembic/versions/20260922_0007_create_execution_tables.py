# migration 0007：新建执行监控两表（对齐需求 4.13 / 4.14，execution.md D1-D4）
"""create execution log tables (spec 4.13 / 4.14, execution.md)

Revision ID: 20260922_0007
Revises: 20260922_0006
Create Date: 2026-09-22
"""

import sqlalchemy as sa

from alembic import op

revision = "20260922_0007"
down_revision = "20260922_0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. agent_execution_logs：step 级执行轨迹（需求 4.13）
    # 审计数据不设外键（D4）：agent/conversation 仅存数值，不随业务删除级联
    # 补充列：organization_id / user_id（组织隔离 + member 本人可见）、created_at、duration_ms
    op.create_table(
        "agent_execution_logs",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("execution_id", sa.String(length=36), nullable=False),
        sa.Column("organization_id", sa.BigInteger(), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("agent_id", sa.BigInteger(), nullable=False),
        sa.Column("conversation_id", sa.BigInteger(), nullable=False),
        sa.Column("step_type", sa.String(length=20), nullable=False),
        sa.Column("step_name", sa.String(length=100), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("input_json", sa.JSON(), nullable=True),
        sa.Column("output_json", sa.JSON(), nullable=True),
        sa.Column("duration_ms", sa.Integer(), server_default="0", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_agent_execution_logs_execution_id", "agent_execution_logs", ["execution_id"]
    )
    op.create_index(
        "ix_agent_execution_logs_organization_id",
        "agent_execution_logs",
        ["organization_id"],
    )
    op.create_index(
        "ix_agent_execution_logs_user_id", "agent_execution_logs", ["user_id"]
    )
    op.create_index(
        "ix_agent_execution_logs_agent_id", "agent_execution_logs", ["agent_id"]
    )
    op.create_index(
        "ix_agent_execution_logs_conversation_id",
        "agent_execution_logs",
        ["conversation_id"],
    )

    # 2. llm_usage_logs：LLM 调用级 token/耗时（需求 4.14）
    # 补充列：execution_id / organization_id / conversation_id / round（tool-calling 多轮归属）
    op.create_table(
        "llm_usage_logs",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("execution_id", sa.String(length=36), nullable=False),
        sa.Column("organization_id", sa.BigInteger(), nullable=False),
        sa.Column("agent_id", sa.BigInteger(), nullable=False),
        sa.Column("conversation_id", sa.BigInteger(), nullable=False),
        sa.Column("provider", sa.String(length=50), nullable=False),
        sa.Column("model", sa.String(length=100), nullable=False),
        sa.Column("input_tokens", sa.Integer(), server_default="0", nullable=False),
        sa.Column("output_tokens", sa.Integer(), server_default="0", nullable=False),
        sa.Column("total_tokens", sa.Integer(), server_default="0", nullable=False),
        sa.Column("latency_ms", sa.Integer(), server_default="0", nullable=False),
        sa.Column("round", sa.Integer(), server_default="1", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_llm_usage_logs_execution_id", "llm_usage_logs", ["execution_id"]
    )
    op.create_index(
        "ix_llm_usage_logs_organization_id", "llm_usage_logs", ["organization_id"]
    )
    op.create_index("ix_llm_usage_logs_agent_id", "llm_usage_logs", ["agent_id"])
    op.create_index(
        "ix_llm_usage_logs_conversation_id", "llm_usage_logs", ["conversation_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_llm_usage_logs_conversation_id", table_name="llm_usage_logs")
    op.drop_index("ix_llm_usage_logs_agent_id", table_name="llm_usage_logs")
    op.drop_index("ix_llm_usage_logs_organization_id", table_name="llm_usage_logs")
    op.drop_index("ix_llm_usage_logs_execution_id", table_name="llm_usage_logs")
    op.drop_table("llm_usage_logs")
    op.drop_index(
        "ix_agent_execution_logs_conversation_id", table_name="agent_execution_logs"
    )
    op.drop_index("ix_agent_execution_logs_agent_id", table_name="agent_execution_logs")
    op.drop_index("ix_agent_execution_logs_user_id", table_name="agent_execution_logs")
    op.drop_index(
        "ix_agent_execution_logs_organization_id", table_name="agent_execution_logs"
    )
    op.drop_index(
        "ix_agent_execution_logs_execution_id", table_name="agent_execution_logs"
    )
    op.drop_table("agent_execution_logs")
