# migration 0009：新增 model_providers / provider_models 表与 agent_versions.provider_id（model-providers.md §2/§3）
"""create model_providers & provider_models, add agent_versions.provider_id

Revision ID: 20260929_0009
Revises: 20260929_0008
Create Date: 2026-09-29
"""

import sqlalchemy as sa

from alembic import op

revision = "20260929_0009"
down_revision = "20260929_0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. 供应商表（组织作用域，api_key 仅存 Fernet 密文，model-providers.md D5）
    op.create_table(
        "model_providers",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("organization_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column(
            "provider_type",
            sa.String(length=30),
            server_default="custom",
            nullable=False,
        ),
        sa.Column("base_url", sa.String(length=500), nullable=False),
        sa.Column("api_key_encrypted", sa.Text(), nullable=True),
        sa.Column("enabled", sa.Boolean(), server_default=sa.text("1"), nullable=False),
        sa.Column("created_by", sa.BigInteger(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"]),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "organization_id", "name", name="uq_model_provider_org_name"
        ),
    )
    op.create_index(
        "ix_model_providers_organization_id",
        "model_providers",
        ["organization_id"],
    )

    # 2. 模型清单表（能力矩阵 JSON，随供应商级联删除）
    op.create_table(
        "provider_models",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("provider_id", sa.BigInteger(), nullable=False),
        sa.Column("model_key", sa.String(length=100), nullable=False),
        sa.Column("display_name", sa.String(length=100), nullable=False),
        sa.Column("capabilities", sa.JSON(), nullable=True),
        sa.Column("enabled", sa.Boolean(), server_default=sa.text("1"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["provider_id"], ["model_providers.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("provider_id", "model_key", name="uq_provider_model_key"),
    )
    op.create_index(
        "ix_provider_models_provider_id", "provider_models", ["provider_id"]
    )

    # 3. agent_versions 路由真源列（D2：NULL = 全局 LLM_API_BASE 回落，无存量回填；
    # RESTRICT 保证删除供应商前引用计数归零，model-providers.md D7）
    op.add_column(
        "agent_versions", sa.Column("provider_id", sa.BigInteger(), nullable=True)
    )
    op.create_foreign_key(
        "fk_agent_versions_provider",
        "agent_versions",
        "model_providers",
        ["provider_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index("ix_agent_versions_provider_id", "agent_versions", ["provider_id"])


def downgrade() -> None:
    op.drop_index("ix_agent_versions_provider_id", table_name="agent_versions")
    op.drop_constraint(
        "fk_agent_versions_provider", "agent_versions", type_="foreignkey"
    )
    op.drop_column("agent_versions", "provider_id")
    op.drop_index("ix_provider_models_provider_id", table_name="provider_models")
    op.drop_table("provider_models")
    op.drop_index("ix_model_providers_organization_id", table_name="model_providers")
    op.drop_table("model_providers")
