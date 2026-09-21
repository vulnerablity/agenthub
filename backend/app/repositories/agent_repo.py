# repositories/agent_repo.py
# agents / agent_versions 数据访问层（Service 层不直接写 SQL）
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Agent, AgentVersion


class AgentRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    # ---------- Agent ----------

    async def get_by_id(self, agent_id: int) -> Agent | None:
        return await self.db.get(Agent, agent_id)

    async def get_by_id_for_update(self, agent_id: int) -> Agent | None:
        """行锁读取（SELECT ... FOR UPDATE）：版本创建/发布/回滚前串行化同一智能体的并发写"""
        result = await self.db.execute(
            select(Agent).where(Agent.id == agent_id).with_for_update()
        )
        return result.scalar_one_or_none()

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
        """解散组织前清空其全部智能体（agent_versions 随外键 CASCADE 级联，设计文档 D8）"""
        await self.db.execute(delete(Agent).where(Agent.organization_id == org_id))

    # ---------- AgentVersion ----------

    async def get_version(self, version_id: int) -> AgentVersion | None:
        return await self.db.get(AgentVersion, version_id)

    async def create_version(self, version: AgentVersion) -> AgentVersion:
        """新增版本并 flush 拿到自增 id"""
        self.db.add(version)
        await self.db.flush()
        return version

    async def next_version_number(self, agent_id: int) -> int:
        """下一个版本序号 = 当前最大版本 + 1"""
        result = await self.db.execute(
            select(func.max(AgentVersion.version)).where(
                AgentVersion.agent_id == agent_id
            )
        )
        current = result.scalar_one()
        return (current or 0) + 1

    async def list_versions(
        self,
        agent_id: int | None = None,
        version_ids: set[int] | None = None,
    ) -> list[AgentVersion]:
        """版本列表（新版本在前）：按 agent 过滤，或按 id 集合批量取（供列表页映射版本号）"""
        stmt = select(AgentVersion).order_by(
            AgentVersion.version.desc(), AgentVersion.id.desc()
        )
        if version_ids is not None:
            stmt = stmt.where(AgentVersion.id.in_(version_ids))
        elif agent_id is not None:
            stmt = stmt.where(AgentVersion.agent_id == agent_id)
        result = await self.db.execute(stmt)
        return list(result.scalars().all())
