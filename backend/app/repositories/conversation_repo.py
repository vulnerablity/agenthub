# repositories/conversation_repo.py
# conversations / messages 数据访问层（Service 层不直接写 SQL；chat.md D12 组织过滤在此实现）
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Agent, AgentVersion, Conversation, Message


class ConversationRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    # ---------- Conversation ----------

    async def get_by_id(self, conversation_id: int) -> Conversation | None:
        return await self.db.get(Conversation, conversation_id)

    async def get_owned_with_agent(
        self, conversation_id: int, user_id: int, org_id: int
    ) -> tuple[Conversation, str, str | None] | None:
        """会话双条件校验（chat.md D1 + D12）：归属当前用户 且 经 agent 归属当前组织。

        JOIN agents 比对 organization_id，不满足一律返回 None（上层转 404，不泄露存在性）。
        同时带出 agent_name / agent_avatar_url 供详情与删除复用。
        """
        result = await self.db.execute(
            select(Conversation, Agent.name, Agent.avatar_url)
            .join(Agent, Agent.id == Conversation.agent_id)
            .where(
                Conversation.id == conversation_id,
                Conversation.user_id == user_id,
                Agent.organization_id == org_id,
            )
        )
        row = result.one_or_none()
        if row is None:
            return None
        return row[0], row[1], row[2]

    async def get_agent(self, agent_id: int) -> Agent | None:
        return await self.db.get(Agent, agent_id)

    async def get_version(self, version_id: int) -> AgentVersion | None:
        return await self.db.get(AgentVersion, version_id)

    async def create(self, conversation: Conversation) -> Conversation:
        """新增会话并 flush 拿到自增 id"""
        self.db.add(conversation)
        await self.db.flush()
        return conversation

    async def delete(self, conversation: Conversation) -> None:
        await self.db.delete(conversation)

    async def list_by_user_with_last_message(
        self,
        user_id: int,
        org_id: int,
        agent_id: int | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[tuple[Conversation, str, str | None, str | None, object]]:
        """当前用户会话列表（chat.md D12 查询层组织过滤 + 需求补充列表接口）。

        JOIN agents 出名称/头像与组织过滤；两个标量子查询带出最后消息摘要（50 字）与时间。
        返回行：(conversation, agent_name, agent_avatar_url, last_message_preview, last_message_at)。
        """
        preview_subq = (
            select(func.left(Message.content, 50))
            .where(Message.conversation_id == Conversation.id)
            .order_by(Message.id.desc())
            .limit(1)
            .correlate(Conversation)
            .scalar_subquery()
        )
        last_at_subq = (
            select(Message.created_at)
            .where(Message.conversation_id == Conversation.id)
            .order_by(Message.id.desc())
            .limit(1)
            .correlate(Conversation)
            .scalar_subquery()
        )
        stmt = (
            select(
                Conversation,
                Agent.name,
                Agent.avatar_url,
                preview_subq,
                last_at_subq,
            )
            .join(Agent, Agent.id == Conversation.agent_id)
            .where(
                Conversation.user_id == user_id,
                Agent.organization_id == org_id,
            )
            .order_by(Conversation.updated_at.desc(), Conversation.id.desc())
            .limit(limit)
            .offset(offset)
        )
        if agent_id is not None:
            stmt = stmt.where(Conversation.agent_id == agent_id)
        result = await self.db.execute(stmt)
        return [
            (row[0], row[1], row[2], row[3], row[4]) for row in result.all()
        ]

    # ---------- Message ----------

    async def create_message(self, message: Message) -> Message:
        """新增消息并 flush 拿到自增 id"""
        self.db.add(message)
        await self.db.flush()
        return message

    async def list_messages(
        self,
        conversation_id: int,
        limit: int | None = None,
        before_id: int | None = None,
    ) -> list[Message]:
        """历史消息按 id 升序（旧在前，供 LLM 上下文组装与页面加载）"""
        stmt = (
            select(Message)
            .where(Message.conversation_id == conversation_id)
            .order_by(Message.id.asc())
        )
        if before_id is not None:
            stmt = stmt.where(Message.id < before_id)
        if limit is not None:
            stmt = stmt.limit(limit)
        result = await self.db.execute(stmt)
        return list(result.scalars().all())

    async def list_recent_messages(
        self, conversation_id: int, limit: int
    ) -> list[Message]:
        """最近的 N 条消息按 id 升序（旧在前）：先倒序取 N 再翻转，供 LLM 上下文组装"""
        result = await self.db.execute(
            select(Message)
            .where(Message.conversation_id == conversation_id)
            .order_by(Message.id.desc())
            .limit(limit)
        )
        return list(reversed(result.scalars().all()))