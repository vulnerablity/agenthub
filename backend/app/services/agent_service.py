# services/agent_service.py
# 智能体 CRUD 与版本管理业务逻辑（组织存在/成员身份/角色兜底在 api/deps.require_header_org_role；
# 智能体归属（agent.organization_id == org.id）为本模块数据隔离的第二道闸）
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import (
    AgentFieldRequired,
    AgentNameConflict,
    AgentNotFound,
    AgentVersionNotFound,
)
from app.models import Agent, AgentVersion, Organization, User
from app.repositories.agent_repo import AgentRepository
from app.schemas.agent import (
    AgentCreateRequest,
    AgentDetail,
    AgentListItem,
    AgentStatusRequest,
    AgentUpdateRequest,
    AgentVersionCreateRequest,
    AgentVersionItem,
)


class AgentService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.repo = AgentRepository(db)

    # ---------- Agent CRUD ----------

    async def create_agent(
        self, org: Organization, user: User, data: AgentCreateRequest
    ) -> AgentDetail:
        """创建智能体：基础信息 + 初始配置自动生成 v1 并发布（需求 3.3 + 3.4 初始版本）"""
        if await self.repo.name_exists(org.id, data.name):
            raise AgentNameConflict()
        agent = await self.repo.create(
            Agent(
                organization_id=org.id,
                name=data.name,
                description=data.description,
                avatar_url=data.avatar_url,
                status=data.status,
                created_by=user.id,
            )
        )
        version = await self.repo.create_version(
            AgentVersion(
                agent_id=agent.id,
                version=1,
                system_prompt=data.system_prompt,
                model_provider=data.model_provider,
                model_name=data.model_name,
                temperature=data.temperature,
                max_tokens=data.max_tokens,
                config_json=data.config_json,
                created_by=user.id,
            )
        )
        agent.current_version_id = version.id
        try:
            # 显式 flush 落库 UPDATE（refresh 不保证触发 autoflush，勿依赖）；
            # 随后 refresh 取回 server_default 的 created_at / updated_at / status；commit 兜底唯一约束冲突
            await self.db.flush()
            await self.db.refresh(agent)
            await self.db.refresh(version)
            await self.db.commit()
        except IntegrityError as exc:
            await self.db.rollback()
            raise AgentNameConflict() from exc
        return await self._detail(agent, version)

    async def list_agents(
        self, org: Organization, name: str | None, status: str | None
    ) -> list[AgentListItem]:
        agents = await self.repo.list_by_org(org.id, name, status)
        version_numbers = await self._current_version_numbers(
            [a.current_version_id for a in agents if a.current_version_id is not None]
        )
        return [
            AgentListItem(
                id=a.id,
                name=a.name,
                description=a.description,
                avatar_url=a.avatar_url,
                status=a.status,
                current_version=(
                    version_numbers.get(a.current_version_id)
                    if a.current_version_id is not None
                    else None
                ),
                created_at=a.created_at,
                updated_at=a.updated_at,
            )
            for a in agents
        ]

    async def get_agent(self, org: Organization, agent_id: int) -> AgentDetail:
        agent = await self._get_in_org(org, agent_id)
        version = await self._current_version(agent)
        return await self._detail(agent, version)

    async def update_agent(
        self, org: Organization, agent_id: int, data: AgentUpdateRequest
    ) -> AgentDetail:
        """编辑基础信息（名称/描述/头像）；模型与提示词变更走版本流程（需求 3.3/3.4）"""
        agent = await self._get_in_org(org, agent_id)
        values = data.model_dump(exclude_unset=True)
        if "name" in values:
            if values["name"] is None:
                raise AgentFieldRequired("智能体名称")
            if values["name"] != agent.name and await self.repo.name_exists(
                org.id, values["name"]
            ):
                raise AgentNameConflict()
        for key, value in values.items():
            setattr(agent, key, value)
        await self.db.commit()
        # updated_at 带 onupdate，UPDATE 后过期属性需 refresh 取回（async 下不能依赖懒加载）
        await self.db.refresh(agent)
        return await self._detail(agent, await self._current_version(agent))

    async def set_status(
        self, org: Organization, agent_id: int, data: AgentStatusRequest
    ) -> AgentDetail:
        agent = await self._get_in_org(org, agent_id)
        agent.status = data.status
        await self.db.commit()
        await self.db.refresh(agent)
        return await self._detail(agent, await self._current_version(agent))

    async def delete_agent(self, org: Organization, agent_id: int) -> None:
        """删除智能体（agent_versions 随外键 CASCADE 级联）"""
        agent = await self._get_in_org(org, agent_id)
        await self.repo.delete(agent)
        await self.db.commit()

    # ---------- 版本管理（需求 3.4） ----------

    async def list_versions(
        self, org: Organization, agent_id: int
    ) -> list[AgentVersionItem]:
        agent = await self._get_in_org(org, agent_id)
        versions = await self.repo.list_versions(agent_id=agent.id)
        usernames = await self._usernames([v.created_by for v in versions])
        return [self._version_item(v, usernames) for v in versions]

    async def create_version(
        self,
        org: Organization,
        agent_id: int,
        user: User,
        data: AgentVersionCreateRequest,
    ) -> AgentVersionItem:
        """创建新版本（不自动发布，发布走 publish 端点；版本号 = 当前最大 + 1）"""
        agent = await self._get_in_org(org, agent_id)
        next_number = await self.repo.next_version_number(agent.id)
        version = await self.repo.create_version(
            AgentVersion(
                agent_id=agent.id,
                version=next_number,
                system_prompt=data.system_prompt,
                model_provider=data.model_provider,
                model_name=data.model_name,
                temperature=data.temperature,
                max_tokens=data.max_tokens,
                config_json=data.config_json,
                created_by=user.id,
            )
        )
        try:
            await self.db.refresh(version)
            await self.db.commit()
        except IntegrityError as exc:
            # 并发创建同序号版本：唯一约束兜底
            await self.db.rollback()
            raise AgentVersionNotFound() from exc
        return self._version_item(version, await self._usernames([user.id]))

    async def publish_version(
        self, org: Organization, agent_id: int, version_id: int
    ) -> AgentDetail:
        """发布版本：将目标版本设为当前版本（需求 3.4 publish）"""
        return await self._set_current(org, agent_id, version_id)

    async def rollback_version(
        self, org: Organization, agent_id: int, version_id: int
    ) -> AgentDetail:
        """回滚版本：将当前版本指回目标历史版本（需求 3.4 rollback，与 publish 同机制）"""
        return await self._set_current(org, agent_id, version_id)

    # ---------- 内部 ----------

    async def _get_in_org(self, org: Organization, agent_id: int) -> Agent:
        """归属校验：智能体不存在或不属于当前组织一律 404（不泄露跨组织存在性）"""
        agent = await self.repo.get_by_id(agent_id)
        if agent is None or agent.organization_id != org.id:
            raise AgentNotFound()
        return agent

    async def _set_current(
        self, org: Organization, agent_id: int, version_id: int
    ) -> AgentDetail:
        agent = await self._get_in_org(org, agent_id)
        version = await self.repo.get_version(version_id)
        if version is None or version.agent_id != agent.id:
            raise AgentVersionNotFound()
        agent.current_version_id = version.id
        await self.db.commit()
        await self.db.refresh(agent)
        return await self._detail(agent, version)

    async def _current_version(self, agent: Agent) -> AgentVersion | None:
        if agent.current_version_id is None:
            return None
        return await self.repo.get_version(agent.current_version_id)

    async def _current_version_numbers(self, version_ids: list[int]) -> dict[int, int]:
        if not version_ids:
            return {}
        versions = await self.repo.list_versions(version_ids=set(version_ids))
        return {v.id: v.version for v in versions}

    async def _usernames(self, user_ids: list[int]) -> dict[int, str]:
        if not user_ids:
            return {}
        result = await self.db.execute(
            select(User.id, User.username).where(User.id.in_(set(user_ids)))
        )
        return {uid: username for uid, username in result.all()}

    @staticmethod
    def _version_item(
        version: AgentVersion, usernames: dict[int, str]
    ) -> AgentVersionItem:
        return AgentVersionItem(
            id=version.id,
            version=version.version,
            system_prompt=version.system_prompt,
            model_provider=version.model_provider,
            model_name=version.model_name,
            temperature=version.temperature,
            max_tokens=version.max_tokens,
            config_json=version.config_json,
            created_by_username=usernames.get(version.created_by, "未知用户"),
            created_at=version.created_at,
        )

    async def _detail(self, agent: Agent, version: AgentVersion | None) -> AgentDetail:
        usernames = await self._usernames(
            [agent.created_by] + ([version.created_by] if version is not None else [])
        )
        return AgentDetail(
            id=agent.id,
            name=agent.name,
            description=agent.description,
            avatar_url=agent.avatar_url,
            status=agent.status,
            current_version=version.version if version is not None else None,
            current_version_detail=(
                self._version_item(version, usernames) if version is not None else None
            ),
            created_by_username=usernames.get(agent.created_by, "未知用户"),
            created_at=agent.created_at,
            updated_at=agent.updated_at,
        )
