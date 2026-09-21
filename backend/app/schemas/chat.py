# schemas/chat.py
# 对话模块请求/响应模型与 SSE 事件载荷（对齐需求文档 3.5 / 4.11 / 4.12，chat.md 2.3 / 2.4）
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class ConversationCreateRequest(BaseModel):
    """创建会话请求（需求 3.5 POST /conversations）"""

    agent_id: int
    title: str | None = Field(default=None, max_length=200)


class ConversationDetail(BaseModel):
    """会话详情：含 Agent 信息与版本快照（chat.md D6 可追溯由哪个版本生成）"""

    id: int
    agent_id: int
    agent_name: str
    agent_avatar_url: str | None
    agent_version_id: int | None
    title: str
    created_at: datetime
    updated_at: datetime


class ConversationListItem(BaseModel):
    """会话列表项：JOIN agents 带出名称/头像，子查询带出最后消息摘要"""

    id: int
    agent_id: int
    agent_name: str
    agent_avatar_url: str | None
    title: str
    last_message_preview: str | None
    last_message_at: datetime | None
    created_at: datetime
    updated_at: datetime


class MessageCreateRequest(BaseModel):
    """发送消息请求（需求 3.5 messages / stream 共用）"""

    content: str = Field(min_length=1, max_length=10000)


class MessageDetail(BaseModel):
    """消息（需求 4.12；token_usage 为流式结束后写入，可空）"""

    id: int
    conversation_id: int
    role: str
    content: str
    token_usage: dict[str, Any] | None
    metadata_json: dict[str, Any] | None
    created_at: datetime


# -------- SSE 事件载荷（chat.md 2.4，与需求 3.5 事件协议对齐） --------


class SseDonePayload(BaseModel):
    """done 事件：助手消息落库 id 与 token_usage；LLM 空输出时 message_id 为 null（chat.md D13）"""

    message_id: int | None
    token_usage: dict[str, Any] | None


class SseErrorPayload(BaseModel):
    """error 事件：流中失败（流前失败走统一 JSON 业务错误，不走 SSE）"""

    code: str
    message: str