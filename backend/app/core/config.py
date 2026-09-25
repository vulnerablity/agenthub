# core/config.py
# 全局配置：基于 pydantic-settings 加载环境变量
# 优先级：进程环境变量（docker compose 注入）> backend/.env > 根目录 .env > 代码默认值
from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# backend 目录绝对路径（config.py 位于 app/core/ 下，向上两级）
BACKEND_DIR = Path(__file__).resolve().parents[2]
# 仓库根目录（backend 的上一级，.env.example 所在位置）
PROJECT_ROOT = Path(__file__).resolve().parents[3]

# 本地直接运行（uvicorn）时：
#   - 根目录 .env 供 docker compose / 部署模板使用（字段与 .env.example 一致）
#   - backend/.env 供本机直连数据库使用（含本机 MySQL/Redis 实际凭据）
# 两者任一存在都会被读取，backend/.env 优先级更高；都不存在时走代码默认值。
# Docker 容器内 .env 已被 .dockerignore 排除，配置完全来自 compose 注入的环境变量。
_env_files = [
    str(path) for path in (PROJECT_ROOT / ".env", BACKEND_DIR / ".env") if path.exists()
]


class Settings(BaseSettings):
    """应用配置，字段名与 .env 中的变量一一对应"""

    model_config = SettingsConfigDict(
        env_file=_env_files,
        env_file_encoding="utf-8",
        extra="ignore",
        # 允许字段名本身作为候选别名（配合下方 AliasChoices 兼容旧字段名）
        populate_by_name=True,
    )

    # 应用
    APP_NAME: str = "AgentHub"
    APP_ENV: str = "development"
    DEBUG: bool = True
    API_V1_PREFIX: str = "/api/v1"

    # 安全 / JWT
    JWT_SECRET_KEY: str = "change-me-in-production"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # MySQL（统一使用 asyncmy 异步驱动）
    MYSQL_HOST: str = "localhost"
    MYSQL_PORT: int = 3306
    MYSQL_DATABASE: str = "agenthub"
    MYSQL_USER: str = "root"
    MYSQL_PASSWORD: str = ""
    DATABASE_URL: str = ""

    # Redis
    REDIS_URL: str = "redis://localhost:6379/0"

    # LLM（OpenAI 兼容协议；chat 模块，模型名由会话绑定的 Agent 版本决定）
    # 兼容旧字段名 LLM_BASE_URL（V1 早期根目录 .env 使用），两者任一配置即生效
    LLM_API_BASE: str = Field(
        default="",
        validation_alias=AliasChoices("LLM_API_BASE", "LLM_BASE_URL"),
    )
    LLM_API_KEY: str = ""
    LLM_TIMEOUT_SECONDS: int = 60
    CHAT_HISTORY_LIMIT: int = 20

    # 向量库（Qdrant；知识库模块，knowledge.md 2）
    QDRANT_URL: str = "http://localhost:6333"
    QDRANT_API_KEY: str = ""

    # Embedding（OpenAI 兼容 /embeddings；全局单模型，运行期固定不可切换，knowledge.md D2）
    EMBEDDING_PROVIDER: str = "openai"
    EMBEDDING_MODEL: str = "text-embedding-3-small"
    EMBEDDING_API_KEY: str = ""
    EMBEDDING_BASE_URL: str = ""
    EMBEDDING_BATCH_SIZE: int = 32

    # 知识库存储与文档处理（knowledge.md 2）
    UPLOAD_DIR: str = "./storage/uploads"
    MAX_UPLOAD_SIZE_MB: int = 20
    WORKER_CONCURRENCY: int = 2
    DOCUMENT_PROCESSING_TIMEOUT: int = 300
    RAG_DEFAULT_TOP_K: int = 5

    # CORS（逗号分隔多个来源）
    CORS_ORIGINS: str = "http://localhost:5173"

    @property
    def embedding_base_url(self) -> str:
        """Embedding 网关未配置时回落 LLM 网关（knowledge.md D10）"""
        return self.EMBEDDING_BASE_URL or self.LLM_API_BASE

    @property
    def embedding_api_key(self) -> str:
        """Embedding 密钥未配置时回落 LLM 密钥（knowledge.md D10）"""
        return self.EMBEDDING_API_KEY or self.LLM_API_KEY

    @property
    def max_upload_size_bytes(self) -> int:
        return self.MAX_UPLOAD_SIZE_MB * 1024 * 1024

    @property
    def database_url(self) -> str:
        """优先使用显式的 DATABASE_URL，否则由 MySQL 分项拼接"""
        if self.DATABASE_URL:
            return self.DATABASE_URL
        return (
            f"mysql+asyncmy://{self.MYSQL_USER}:{self.MYSQL_PASSWORD}"
            f"@{self.MYSQL_HOST}:{self.MYSQL_PORT}/{self.MYSQL_DATABASE}"
        )

    @property
    def cors_origins_list(self) -> list[str]:
        return [
            origin.strip() for origin in self.CORS_ORIGINS.split(",") if origin.strip()
        ]

    @property
    def access_token_expire_seconds(self) -> int:
        return self.ACCESS_TOKEN_EXPIRE_MINUTES * 60

    @property
    def refresh_token_expire_seconds(self) -> int:
        return self.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 3600

    @model_validator(mode="after")
    def _guard_production_defaults(self) -> "Settings":
        """生产环境（APP_ENV=production）缺失关键密钥时拒绝启动，而不是带默认值运行。

        仅对显式声明 production 的环境生效；development / 测试环境不受影响。
        """
        if self.APP_ENV != "production":
            return self
        missing = []
        if not self.JWT_SECRET_KEY or self.JWT_SECRET_KEY == "change-me-in-production":
            missing.append("JWT_SECRET_KEY")
        if not self.LLM_API_BASE:
            missing.append("LLM_API_BASE")
        if not self.MYSQL_PASSWORD or self.MYSQL_PASSWORD == "change-me":
            missing.append("MYSQL_PASSWORD")
        if missing:
            raise ValueError(
                "生产环境（APP_ENV=production）禁止使用默认/空密钥，"
                f"请在环境变量或 .env 中显式设置: {', '.join(missing)}"
            )
        return self


@lru_cache
def get_settings() -> Settings:
    """进程内缓存的配置单例"""
    return Settings()


settings = get_settings()
