# services/chat_service.py
# 对话业务编排（chat.md 2.6）：会话 CRUD + 消息发送（同步 / SSE 流式）
# 组织存在/成员身份/角色校验在 api/deps.require_header_org_role；会话双条件校验（D1 用户私有 + D12 组织隔离）在本层
import asyncio
import json
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any, ClassVar

from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import (
    AgentNotAvailable,
    AgentNotFound,
    ConversationBusy,
    ConversationNotFound,
    LLMTimeout,
    LLMUpstreamError,
    MessageContentRequired,
)
from app.integrations.llm import get_llm_client
from app.models import AgentVersion, Conversation, Message, Organization, User
from app.repositories.conversation_repo import ConversationRepository
from app.schemas.chat import (
    ConversationCreateRequest,
    ConversationDetail,
    ConversationListItem,
    MessageCreateRequest,
    MessageDetail,
    SseDonePayload,
    SseErrorPayload,
)

DEFAULT_TITLE = "新对话"


@dataclass
class _StreamCtx:
    """prepare_stream 与 sse_events 之间的传递状态（同一请求内）"""

    conversation: Conversation
    version: AgentVersion
    llm_message: list[dict[str, str]]
    user_content: str


def _sse(event: str, payload: BaseModel | dict) -> str:
    """SSE 帧序列化：`event: xxx\\ndata: {...}\\n\\n`（非 ASCII 不转义）"""
    data = payload if isinstance(payload, dict) else payload.model_dump()
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


class ChatService:
    # 进程内 per-conversation 并发锁（chat.md D11）：本服务单进程部署；
    # 会话删除后遗留的空锁对象体积可忽略，多副本部署时升级为 Redis 锁
    _locks: ClassVar[dict[int, asyncio.Lock]] = {}

    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.repo = ConversationRepository(db)
        self._stream_ctx: _StreamCtx | None = None

    @classmethod
    def _lock_for(cls, conversation_id: int) -> asyncio.Lock:
        return cls._locks.setdefault(conversation_id, asyncio.Lock())

    @staticmethod
    async def _acquire(conversation_id: int) -> asyncio.Lock:
        """非阻塞获取会话锁：已有进行中的生成 → 409 CONVERSATION_BUSY"""
        lock = ChatService._lock_for(conversation_id)
        if lock.locked():
            raise ConversationBusy()
        await lock.acquire()
        return lock

    # ---------- 会话 CRUD（chat.md 2.3） ----------

    async def create_conversation(
        self, org: Organization, user: User, data: ConversationCreateRequest
    ) -> ConversationDetail:
        """创建会话：校验 Agent 归属/可用性，快照当前发布版本（chat.md D6）"""
        agent = await self.repo.get_agent(data.agent_id)
        if agent is None or agent.organization_id != org.id:
            raise AgentNotFound()
        if agent.status != "enabled" or agent.current_version_id is None:
            raise AgentNotAvailable()
        conversation = await self.repo.create(
            Conversation(
                user_id=user.id,
                agent_id=agent.id,
                agent_version_id=agent.current_version_id,
                title=(data.title or "").strip() or DEFAULT_TITLE,
            )
        )
        await self.db.commit()
        await self.db.refresh(conversation)
        return self._conversation_detail(conversation, agent)

    async def list_conversations(
        self,
        org: Organization,
        user: User,
        agent_id: int | None,
        limit: int,
        offset: int,
    ) -> list[ConversationListItem]:
        rows = await self.repo.list_by_user_with_last_message(
            user.id, org.id, agent_id, limit, offset
        )
        return [
            ConversationListItem(
                id=c.id,
                agent_id=c.agent_id,
                agent_name=agent_name,
                agent_avatar_url=agent_avatar,
                title=c.title,
                last_message_preview=preview,
                last_message_at=last_at,
                created_at=c.created_at,
                updated_at=c.updated_at,
            )
            for c, agent_name, agent_avatar, preview, last_at in rows
        ]

    async def get_conversation(
        self, org: Organization, user: User, conversation_id: int
    ) -> ConversationDetail:
        conversation, agent_id = await self._get_owned(org, user, conversation_id)
        agent = await self.repo.get_agent(agent_id)
        if agent is None:
            raise ConversationNotFound()
        return self._conversation_detail(conversation, agent)

    async def delete_conversation(
        self, org: Organization, user: User, conversation_id: int
    ) -> None:
        """删除会话（messages 随外键 CASCADE 清理）"""
        conversation, _ = await self._get_owned(org, user, conversation_id)
        await self.repo.delete(conversation)
        await self.db.commit()

    async def list_messages(
        self,
        org: Organization,
        user: User,
        conversation_id: int,
        limit: int,
        before_id: int | None,
    ) -> list[MessageDetail]:
        conversation, _ = await self._get_owned(org, user, conversation_id)
        messages = await self.repo.list_messages(
            conversation.id, limit=limit, before_id=before_id
        )
        return [self._message_detail(m) for m in messages]

    # ---------- 发送消息（chat.md 2.6） ----------

    async def send_message(
        self,
        org: Organization,
        user: User,
        conversation_id: int,
        data: MessageCreateRequest,
    ) -> MessageDetail:
        """同步发送（需求 3.5 POST /messages，前端默认走 stream，本接口供测试/自动化）"""
        content = data.content.strip()
        if not content:
            raise MessageContentRequired()
        conversation, _ = await self._get_owned(org, user, conversation_id)
        lock = await self._acquire(conversation.id)
        try:
            return await self._run_generation(conversation, content)
        finally:
            lock.release()

    async def prepare_stream(
        self,
        org: Organization,
        user: User,
        conversation_id: int,
        data: MessageCreateRequest,
    ) -> None:
        """流式前置校验（stream 端点流开始前集中返回业务错误；chat.md 2.6 步骤 1-5）"""
        content = data.content.strip()
        if not content:
            raise MessageContentRequired()
        conversation, _ = await self._get_owned(org, user, conversation_id)
        ctx, _ = await self._prepare_generation(conversation, content)
        # 锁在 _prepare_generation 内获取并随 ctx 保持；服务实例持有直至 sse_events 结束
        self._stream_ctx = ctx

    async def sse_events(self) -> AsyncIterator[str]:
        """SSE 事件流（post 前置校验通过后由 api 层包进 StreamingResponse）"""
        ctx = self._stream_ctx
        assert ctx is not None, "sse_events 必须先经 prepare_stream"
        lock = self._lock_for(ctx.conversation.id)
        try:
            deltas: list[str] = []
            usage: dict[str, Any] | None = None
            try:
                async for item in get_llm_client().chat_stream(
                    messages=ctx.llm_message,
                    model=ctx.version.model_name,
                    temperature=ctx.version.temperature,
                    max_tokens=ctx.version.max_tokens,
                ):
                    if "delta" in item:
                        deltas.append(item["delta"])
                        yield _sse("message", {"delta": item["delta"]})
                    else:
                        usage = item.get("usage")
            except (LLMUpstreamError, LLMTimeout) as exc:
                yield _sse("error", SseErrorPayload(code=exc.code, message=exc.message))
                return

            if not deltas:
                # LLM 空输出（chat.md D13）：不落库 assistant 消息，done 置空
                yield _sse("done", SseDonePayload(message_id=None, token_usage=None))
                return

            assistant = await self._persist_assistant(
                ctx.conversation, ctx.user_content, "".join(deltas), usage, ctx.version
            )
            yield _sse(
                "done",
                SseDonePayload(message_id=assistant.id, token_usage=usage),
            )
        finally:
            lock.release()

    # ---------- 内部 ----------

    async def _get_owned(
        self, org: Organization, user: User, conversation_id: int
    ) -> tuple[Conversation, int]:
        """会话双条件校验（chat.md D1 + D12）：不属于当前用户或经 agent 不属于当前组织 → 404"""
        row = await self.repo.get_owned_with_agent(conversation_id, user.id, org.id)
        if row is None:
            raise ConversationNotFound()
        return row[0], row[0].agent_id

    async def _prepare_generation(
        self, conversation: Conversation, content: str
    ) -> tuple[_StreamCtx, asyncio.Lock]:
        """通用生成前置：拿锁 → 校验 Agent 可用 → 加载版本快照 → 组上下文 → 落库用户消息"""
        lock = await self._acquire(conversation.id)
        try:
            ctx = await self._build_context(conversation, content)
        except BaseException:
            lock.release()
            raise
        return ctx, lock

    async def _build_context(
        self, conversation: Conversation, content: str
    ) -> _StreamCtx:
        agent = await self.repo.get_agent(conversation.agent_id)
        # 启停即时生效（agent 模块 D5）：禁用后拒绝继续对话
        if agent is None or agent.status != "enabled":
            raise AgentNotAvailable()
        # 会话绑定的版本快照（chat.md D6）；版本缺位（级联置空等异常态）同样拒绝
        if conversation.agent_version_id is None:
            raise AgentNotAvailable()
        version = await self.repo.get_version(conversation.agent_version_id)
        if version is None:
            raise AgentNotAvailable()

        history = await self.repo.list_recent_messages(
            conversation.id, settings.CHAT_HISTORY_LIMIT
        )
        llm_message = [{"role": "system", "content": version.system_prompt}]
        llm_message += [{"role": m.role, "content": m.content} for m in history]
        llm_message.append({"role": "user", "content": content})

        # 用户消息先行落库（D5）：流中失败/断流后可整体重试
        await self.repo.create_message(
            Message(conversation_id=conversation.id, role="user", content=content)
        )
        await self.db.commit()
        return _StreamCtx(
            conversation=conversation,
            version=version,
            llm_message=llm_message,
            user_content=content,
        )

    async def _run_generation(
        self, conversation: Conversation, content: str
    ) -> MessageDetail:
        """同步生成：复用 _build_context 后收集完整回答并落库（流式走 prepare_stream/sse_events）"""
        ctx = await self._build_context(conversation, content)
        deltas: list[str] = []
        usage: dict[str, Any] | None = None
        async for item in get_llm_client().chat_stream(
            messages=ctx.llm_message,
            model=ctx.version.model_name,
            temperature=ctx.version.temperature,
            max_tokens=ctx.version.max_tokens,
        ):
            if "delta" in item:
                deltas.append(item["delta"])
            else:
                usage = item.get("usage")
        if not deltas:
            raise LLMUpstreamError()
        assistant = await self._persist_assistant(
            ctx.conversation, ctx.user_content, "".join(deltas), usage, ctx.version
        )
        return self._message_detail(assistant)

    async def _persist_assistant(
        self,
        conversation: Conversation,
        user_content: str,
        answer: str,
        usage: dict[str, Any] | None,
        version: AgentVersion,
    ) -> Message:
        """助手消息一次性落库（D5）；首轮自动更新标题（D2）；updated_at 随行更新"""
        assistant = await self.repo.create_message(
            Message(
                conversation_id=conversation.id,
                role="assistant",
                content=answer,
                token_usage=usage,
                metadata_json={
                    "model_provider": version.model_provider,
                    "model_name": version.model_name,
                    "agent_version_id": version.id,
                },
            )
        )
        if conversation.title == DEFAULT_TITLE:
            conversation.title = user_content[:30]
        await self.db.commit()
        await self.db.refresh(assistant)
        return assistant

    @staticmethod
    def _message_detail(message: Message) -> MessageDetail:
        return MessageDetail(
            id=message.id,
            conversation_id=message.conversation_id,
            role=message.role,
            content=message.content,
            token_usage=message.token_usage,
            metadata_json=message.metadata_json,
            created_at=message.created_at,
        )

    @staticmethod
    def _conversation_detail(conversation: Conversation, agent) -> ConversationDetail:
        return ConversationDetail(
            id=conversation.id,
            agent_id=agent.id,
            agent_name=agent.name,
            agent_avatar_url=agent.avatar_url,
            agent_version_id=conversation.agent_version_id,
            title=conversation.title,
            created_at=conversation.created_at,
            updated_at=conversation.updated_at,
        )
