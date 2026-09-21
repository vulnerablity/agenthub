# migration 0004：新建 conversations（对齐需求 4.11 + chat.md D6 扩充 agent_version_id）与 messages（需求 4.12）
"""create conversations and messages tables (spec 4.11 / 4.12, chat.md)

Revision ID: 20260921_0004
Revises: 20260920_0003
Create Date: 2026-09-21
"""

import sqlalchemy as sa

from alembic import op

revision = "20260921_0004"
down_revision = "20260920_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. conversations：Agent 删除级联清理会话（chat.md D14）；版本快照置空兜底（chat.md D6）
    op.create_table(
        "conversations",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("agent_id", sa.BigInteger(), nullable=False),
        sa.Column("agent_version_id", sa.BigInteger(), nullable=True),
        sa.Column("title", sa.String(length=200), nullable=False),
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
        sa.ForeignKeyConstraint(["agent_id"], ["agents.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["agent_version_id"], ["agent_versions.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_conversations_user_updated", "conversations", ["user_id", "updated_at"]
    )
    op.create_index("ix_conversations_agent", "conversations", ["agent_id"])

    # 2. messages：会话删除级联清理消息；token_usage 流式结束一次性写入（chat.md D5）
    op.create_table(
        "messages",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("conversation_id", sa.BigInteger(), nullable=False),
        sa.Column("role", sa.String(length=20), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("token_usage", sa.JSON(), nullable=True),
        sa.Column("metadata_json", sa.JSON(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["conversation_id"], ["conversations.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_messages_conversation", "messages", ["conversation_id"])


def downgrade() -> None:
    op.drop_index("ix_messages_conversation", table_name="messages")
    op.drop_table("messages")
    op.drop_index("ix_conversations_agent", table_name="conversations")
    op.drop_index("ix_conversations_user_updated", table_name="conversations")
    op.drop_table("conversations")
