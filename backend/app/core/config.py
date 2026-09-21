# core/config.py
# 全局配置：基于 pydantic-settings 从 backend/.env 加载环境变量
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# backend 目录绝对路径（config.py 位于 app/core/ 下，向上两级）
BACKEND_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    """应用配置，字段名与 .env 中的变量一一对应"""

    model_config = SettingsConfigDict(
        env_file=str(BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
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
    LLM_API_BASE: str = ""
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


@lru_cache
def get_settings() -> Settings:
    """进程内缓存的配置单例"""
    return Settings()


settings = get_settings()
