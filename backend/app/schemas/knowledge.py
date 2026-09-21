# schemas/knowledge.py
# 知识库模块请求/响应模型（对齐需求文档 3.6 / 4.8-4.10，knowledge.md 3.3）
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

# 文档处理状态机（knowledge.md 3.4）
DocumentStatus = Literal["pending", "processing", "completed", "failed"]

DEFAULT_CHUNK_SIZE = 500
DEFAULT_CHUNK_OVERLAP = 50
DEFAULT_TOP_K = 5


class KnowledgeBaseCreateRequest(BaseModel):
    """创建知识库请求（需求 3.6）；chunk 参数仅创建时配置（knowledge.md D7）"""

    name: str = Field(min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=5000)
    chunk_size: int = Field(default=DEFAULT_CHUNK_SIZE, ge=100, le=5000)
    chunk_overlap: int = Field(
        default=DEFAULT_CHUNK_OVERLAP, ge=0, le=DEFAULT_CHUNK_SIZE
    )

    @model_validator(mode="after")
    def _check_overlap(self) -> "KnowledgeBaseCreateRequest":
        # 切块步长 = chunk_size - chunk_overlap 必须为正（knowledge.md D7）
        if self.chunk_overlap >= self.chunk_size:
            raise ValueError("chunk_overlap 必须小于 chunk_size")
        return self


class KnowledgeBaseUpdateRequest(BaseModel):
    """更新知识库请求（需求补充）：仅名称/描述（chunk 参数新建后不可改，D7）"""

    name: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=5000)


class KnowledgeBaseDetail(BaseModel):
    """知识库详情/列表项（含文档统计，knowledge.md 3.3）"""

    id: int
    name: str
    description: str | None
    embedding_model: str
    chunk_size: int
    chunk_overlap: int
    status: str
    document_count: int
    processing_count: int
    created_at: datetime
    updated_at: datetime


class DocumentListItem(BaseModel):
    """文档列表项（需求 4.9 + knowledge.md 增补字段）"""

    id: int
    filename: str
    file_type: str
    file_size: int
    status: str
    error_message: str | None
    chunk_count: int
    created_at: datetime


class DocumentUploadResponse(DocumentListItem):
    """上传响应：与列表项同构（上传即返回 pending 状态文档，D4）"""


class DocumentStatusDetail(BaseModel):
    """文档状态（需求 3.6 GET /documents/{id}/status）"""

    id: int
    filename: str
    status: str
    error_message: str | None
    chunk_count: int


class SearchRequest(BaseModel):
    """RAG 检索请求（需求 3.6）"""

    query: str = Field(min_length=1, max_length=2000)
    top_k: int = Field(default=DEFAULT_TOP_K, ge=1, le=50)


class SearchResultItem(BaseModel):
    """检索结果项：page 为 chunk 首字符所在页（knowledge.md D8），跨页不保证精确"""

    content: str
    document: str
    page: int | None
    score: float


class SearchResponse(BaseModel):
    """检索响应（对齐需求 3.6 示例结构）"""

    results: list[SearchResultItem]


class RAGSource(BaseModel):
    """引用来源（D11）：注入聊天的命中片段结构化表示"""

    content: str
    document: str
    page: int | None
    score: float


class RAGConfig(BaseModel):
    """版本 config_json 中知识库绑定的标准结构（D11）"""

    knowledge_base_ids: list[int] = Field(default_factory=list)
    rag_top_k: int = Field(default=DEFAULT_TOP_K, ge=1, le=50)


def rag_config_from(config_json: dict[str, Any] | None) -> RAGConfig | None:
    """从版本 config_json 解析 RAG 绑定；无 rag 键返回 None 表示未启用（D11）"""
    if not config_json or "rag" not in config_json:
        return None
    raw = config_json["rag"]
    if isinstance(raw, dict):
        return RAGConfig.model_validate(raw)
    return None