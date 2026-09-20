# repositories/agent_repo.py
# agents 数据访问层（Service 层不直接写 SQL）
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Agent


class AgentRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def get_by_id(self, agent_id: int) -> Agent | None:
        return await self.db.get(Agent, agent_id)

    async def create(self, agent: Agent) -> Agent:
        """新增智能体并 flush 拿到自增 id"""
        self.db.add(agent)
        await self.db.flush()
        return agent

    async def name_exists(self, org_id: int, name: str) -> bool:
        """组织内名称占用检查（唯一约束预查）"""
        result = await self.db.execute(
            select(Agent.id)
            .where(Agent.organization_id == org_id, Agent.name == name)
            .limit(1)
        )
        return result.scalar_one_or_none() is not None

    async def list_by_org(
        self, org_id: int, name: str | None = None, status: str | None = None
    ) -> list[Agent]:
        """组织内智能体列表（最近更新在前）；可按名称模糊 / 状态过滤"""
        stmt = (
            select(Agent)
            .where(Agent.organization_id == org_id)
            .order_by(Agent.updated_at.desc(), Agent.id.desc())
        )
        if name:
            stmt = stmt.where(Agent.name.like(f"%{name}%"))
        if status:
            stmt = stmt.where(Agent.status == status)
        result = await self.db.execute(stmt)
        return list(result.scalars().all())

    async def delete(self, agent: Agent) -> None:
        await self.db.delete(agent)

    async def delete_by_org(self, org_id: int) -> None:
        """解散组织前清空其全部智能体（外键顺序，设计文档 D8）"""
        await self.db.execute(delete(Agent).where(Agent.organization_id == org_id))
