# services/agent_service.py
# 智能体 CRUD 业务逻辑（组织存在/成员身份/角色兜底在 api/deps.require_org_role；
# 智能体归属（agent.organization_id == org.id）为本模块数据隔离的第二道闸）
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AgentFieldRequired, AgentNameConflict, AgentNotFound
from app.models import Agent, Organization, User
from app.repositories.agent_repo import AgentRepository
from app.schemas.agent import (
    AgentCreateRequest,
    AgentDetail,
    AgentListItem,
    AgentStatusRequest,
    AgentUpdateRequest,
)

# 更新时不允许置空的必填字段（null 无意义；description 等可空字段传 null 表示清空）
_REQUIRED_FIELDS = {
    "name": "智能体名称",
    "provider": "模型提供方",
    "model": "模型名称",
}


class AgentService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.repo = AgentRepository(db)

    async def create_agent(
        self, org: Organization, user: User, data: AgentCreateRequest
    ) -> AgentDetail:
        """创建智能体（D1：名称组织内唯一，预查 + 唯一约束兜底）"""
        if await self.repo.name_exists(org.id, data.name):
            raise AgentNameConflict()
        agent = await self.repo.create(
            Agent(
                organization_id=org.id,
                name=data.name,
                description=data.description,
                system_prompt=data.system_prompt,
                provider=data.provider,
                model=data.model,
                temperature=data.temperature,
                max_tokens=data.max_tokens,
                created_by=user.id,
            )
        )
        try:
            # refresh 取回 server_default 的 created_at / status；commit 兜底唯一约束冲突
            await self.db.refresh(agent)
            await self.db.commit()
        except IntegrityError as exc:
            await self.db.rollback()
            raise AgentNameConflict() from exc
        return await self._detail(agent)

    async def list_agents(
        self, org: Organization, name: str | None, status: str | None
    ) -> list[AgentListItem]:
        agents = await self.repo.list_by_org(org.id, name, status)
        return [
            AgentListItem(
                id=a.id,
                name=a.name,
                description=a.description,
                provider=a.provider,
                model=a.model,
                status=a.status,
                updated_at=a.updated_at,
            )
            for a in agents
        ]

    async def get_agent(self, org: Organization, agent_id: int) -> AgentDetail:
        agent = await self._get_in_org(org, agent_id)
        return await self._detail(agent)

    async def update_agent(
        self, org: Organization, agent_id: int, data: AgentUpdateRequest
    ) -> AgentDetail:
        """编辑智能体：只更新已传字段（exclude_unset）；可空字段传 null 表示清空"""
        agent = await self._get_in_org(org, agent_id)
        values = data.model_dump(exclude_unset=True)
        if "name" in values:
            if values["name"] is None:
                raise AgentFieldRequired("智能体名称")
            if values["name"] != agent.name and await self.repo.name_exists(
                org.id, values["name"]
            ):
                raise AgentNameConflict()
        for field in ("provider", "model"):
            if field in values and values[field] is None:
                raise AgentFieldRequired(_REQUIRED_FIELDS[field])
        # system_prompt 列为 NOT NULL：清空语义为回退空串
        if "system_prompt" in values and values["system_prompt"] is None:
            values["system_prompt"] = ""
        for key, value in values.items():
            setattr(agent, key, value)
        try:
            await self.db.commit()
            # onupdate=func.now() 使 updated_at 在 UPDATE 后过期，refresh 显式取回（async 下不能依赖懒加载）
            await self.db.refresh(agent)
        except IntegrityError as exc:
            await self.db.rollback()
            raise AgentNameConflict() from exc
        return await self._detail(agent)

    async def set_status(
        self, org: Organization, agent_id: int, data: AgentStatusRequest
    ) -> AgentDetail:
        agent = await self._get_in_org(org, agent_id)
        agent.status = data.status
        await self.db.commit()
        # 同上：refresh 取回 onupdate 后的 updated_at
        await self.db.refresh(agent)
        return await self._detail(agent)

    async def delete_agent(self, org: Organization, agent_id: int) -> None:
        """删除智能体（D5：V1 硬删除，无关联数据）"""
        agent = await self._get_in_org(org, agent_id)
        await self.repo.delete(agent)
        await self.db.commit()

    # ---------- 内部 ----------

    async def _get_in_org(self, org: Organization, agent_id: int) -> Agent:
        """归属校验：智能体不存在或不属于当前组织一律 404（不泄露跨组织存在性）"""
        agent = await self.repo.get_by_id(agent_id)
        if agent is None or agent.organization_id != org.id:
            raise AgentNotFound()
        return agent

    async def _detail(self, agent: Agent) -> AgentDetail:
        result = await self.db.execute(
            select(User.username).where(User.id == agent.created_by)
        )
        creator = result.scalar_one_or_none()
        return AgentDetail(
            id=agent.id,
            name=agent.name,
            description=agent.description,
            system_prompt=agent.system_prompt,
            provider=agent.provider,
            model=agent.model,
            temperature=agent.temperature,
            max_tokens=agent.max_tokens,
            status=agent.status,
            created_by_username=creator if creator else "未知用户",
            created_at=agent.created_at,
            updated_at=agent.updated_at,
        )
