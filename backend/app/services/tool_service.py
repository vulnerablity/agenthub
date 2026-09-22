# services/tool_service.py
# 工具 CRUD / 测试 / Agent 绑定编排（组织存在/成员身份/角色兜底在 api/deps.require_header_org_role；
# 工具归属（tool.organization_id == org.id）为本模块数据隔离的第二道闸，跨组织一律 404）
# 绑定为 Agent 级实时读取（tool-calling.md D05）；删除工具 / 智能体时绑定随外键 CASCADE（D04）
import time

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import (
    AgentNotFound,
    AgentToolAlreadyBound,
    AgentToolNotFound,
    ToolConfigInvalid,
    ToolNameConflict,
    ToolNotFound,
    ToolSchemaInvalid,
    ToolTypeInvalid,
)
from app.integrations.tool_runners import run_tool
from app.models import AgentTool, Organization, Tool
from app.repositories.agent_repo import AgentRepository
from app.repositories.tool_repo import ToolRepository
from app.schemas.tool import (
    CALCULATOR_SCHEMA,
    AgentToolDetail,
    AgentToolUpdateRequest,
    ToolCreateRequest,
    ToolDetail,
    ToolTestRequest,
    ToolTestResponse,
    ToolUpdateRequest,
)

HTTP_METHODS = {"GET", "POST", "PUT", "PATCH", "DELETE"}


class ToolService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.repo = ToolRepository(db)
        self.agent_repo = AgentRepository(db)

    # ---------- 校验与组装 ----------

    @staticmethod
    def _validated_payload(
        tool_type: str, schema: dict, config: dict | None
    ) -> tuple[dict, dict | None]:
        """schema/config 依类型规约（D06）：calculator 固定 schema 且无 config；
        http 必须含合法 url；schema 必须为 object 型 JSON Schema（LLM function.parameters）"""
        if tool_type not in ("calculator", "http"):
            raise ToolTypeInvalid()
        if not isinstance(schema, dict) or schema.get("type") != "object":
            raise ToolSchemaInvalid()
        if tool_type == "calculator":
            return CALCULATOR_SCHEMA, None
        if not isinstance(config, dict) or not isinstance(config.get("url"), str):
            raise ToolConfigInvalid("HTTP 工具必须配置 url")
        url = config["url"].strip()
        if not url or not url.lower().startswith(("http://", "https://")):
            raise ToolConfigInvalid("url 仅支持 http/https 协议")
        method = str(config.get("method", "GET")).upper()
        if method not in HTTP_METHODS:
            raise ToolConfigInvalid(f"不支持的请求方法 {method}")
        normalized = dict(config, url=url, method=method)
        return schema, normalized

    @staticmethod
    def _detail(tool: Tool) -> ToolDetail:
        return ToolDetail(
            id=tool.id,
            name=tool.name,
            description=tool.description,
            type=tool.type,
            tool_schema=tool.schema,
            config=tool.config,
            status=tool.status,
            created_at=tool.created_at,
            updated_at=tool.updated_at,
        )

    async def _get_in_org(self, org: Organization, tool_id: int) -> Tool:
        tool = await self.repo.get_tool(tool_id)
        if tool is None or tool.organization_id != org.id:
            raise ToolNotFound()
        return tool

    # ---------- 工具 CRUD ----------

    async def create_tool(
        self, org: Organization, user_id: int, data: ToolCreateRequest
    ) -> ToolDetail:
        if await self.repo.name_exists(org.id, data.name):
            raise ToolNameConflict()
        schema, config = self._validated_payload(
            data.type, data.tool_schema, data.config
        )
        try:
            tool = await self.repo.create_tool(
                Tool(
                    organization_id=org.id,
                    name=data.name,
                    description=data.description,
                    type=data.type,
                    schema=schema,
                    config=config,
                    created_by=user_id,
                )
            )
            await self.db.commit()
            await self.db.refresh(tool)
        except IntegrityError as exc:
            await self.db.rollback()
            raise ToolNameConflict() from exc
        return self._detail(tool)

    async def list_tools(self, org: Organization) -> list[ToolDetail]:
        tools = await self.repo.list_by_org(org.id)
        return [self._detail(tool) for tool in tools]

    async def get_tool(self, org: Organization, tool_id: int) -> ToolDetail:
        return self._detail(await self._get_in_org(org, tool_id))

    async def update_tool(
        self, org: Organization, tool_id: int, data: ToolUpdateRequest
    ) -> ToolDetail:
        tool = await self._get_in_org(org, tool_id)
        values = data.model_dump(exclude_unset=True)
        if "name" in values:
            if values["name"] and await self.repo.name_exists(org.id, values["name"]):
                raise ToolNameConflict()
            tool.name = values["name"]
        if "description" in values:
            tool.description = values["description"]
        # schema/config 变更走统一规约（type 创建后不可改，D01 语义）
        if "tool_schema" in values or "config" in values:
            schema, config = self._validated_payload(
                tool.type,
                values.get("tool_schema", tool.schema),
                values.get("config", tool.config),
            )
            tool.schema = schema
            tool.config = config
        try:
            await self.db.commit()
            await self.db.refresh(tool)
        except IntegrityError as exc:
            await self.db.rollback()
            raise ToolNameConflict() from exc
        return self._detail(tool)

    async def delete_tool(self, org: Organization, tool_id: int) -> None:
        tool = await self._get_in_org(org, tool_id)
        await self.repo.delete_tool(tool)
        await self.db.commit()

    async def delete_by_org(self, org_id: int) -> None:
        """解散组织前清空工具（tool-calling.md 2.8；绑定已随 agents CASCADE 清理）"""
        await self.repo.delete_by_org(org_id)

    # ---------- 工具测试（需求 3.7） ----------

    async def test_tool(
        self, org: Organization, tool_id: int, data: ToolTestRequest
    ) -> ToolTestResponse:
        tool = await self._get_in_org(org, tool_id)
        started = time.perf_counter()
        result = await run_tool(tool.type, tool.config, data.arguments)
        return ToolTestResponse(
            status=result.status,
            output=result.output,
            error=result.error,
            duration_ms=int((time.perf_counter() - started) * 1000),
        )

    # ---------- Agent 绑定（需求 3.7 / 4.7） ----------

    async def list_agent_tools(
        self, org: Organization, agent_id: int
    ) -> list[AgentToolDetail]:
        """已绑定列表（agent 归属校验沿用 Agent 域 404 语义）"""
        await self._ensure_agent_in_org(org, agent_id)
        rows = await self.repo.list_bindings_with_tool(agent_id)
        return [
            AgentToolDetail(
                id=binding.id,
                agent_id=binding.agent_id,
                tool_id=binding.tool_id,
                tool_name=tool.name,
                tool_type=tool.type,
                tool_description=tool.description,
                enabled=binding.enabled,
                config_json=binding.config_json,
                created_at=binding.created_at,
            )
            for binding, tool in rows
        ]

    async def bind_tool(
        self,
        org: Organization,
        agent_id: int,
        tool_id: int,
        enabled: bool,
        config: dict | None,
    ) -> AgentToolDetail:
        """绑定：双方均须归属当前组织；重复绑定 409；config_json 覆盖 tools.config（D08）"""
        await self._ensure_agent_in_org(org, agent_id)
        tool = await self._get_in_org(org, tool_id)
        if await self.repo.get_binding(agent_id, tool_id) is not None:
            raise AgentToolAlreadyBound()
        try:
            binding = await self.repo.create_binding(
                AgentTool(
                    agent_id=agent_id,
                    tool_id=tool_id,
                    enabled=enabled,
                    config_json=config,
                )
            )
            await self.db.commit()
            await self.db.refresh(binding)
        except IntegrityError as exc:
            await self.db.rollback()
            raise AgentToolAlreadyBound() from exc
        return AgentToolDetail(
            id=binding.id,
            agent_id=binding.agent_id,
            tool_id=binding.tool_id,
            tool_name=tool.name,
            tool_type=tool.type,
            tool_description=tool.description,
            enabled=binding.enabled,
            config_json=binding.config_json,
            created_at=binding.created_at,
        )

    async def update_binding(
        self,
        org: Organization,
        agent_id: int,
        tool_id: int,
        data: AgentToolUpdateRequest,
    ) -> AgentToolDetail:
        """更新绑定（enabled 开关 / 绑定级 config 覆盖）；config_json 置 null 即回退工具默认配置（D08）"""
        await self._ensure_agent_in_org(org, agent_id)
        tool = await self._get_in_org(org, tool_id)
        binding = await self.repo.get_binding(agent_id, tool_id)
        if binding is None:
            raise AgentToolNotFound()
        values = data.model_dump(exclude_unset=True)
        if "enabled" in values:
            binding.enabled = values["enabled"]
        if "config_json" in values:
            binding.config_json = values["config_json"]
        await self.db.commit()
        await self.db.refresh(binding)
        return AgentToolDetail(
            id=binding.id,
            agent_id=binding.agent_id,
            tool_id=binding.tool_id,
            tool_name=tool.name,
            tool_type=tool.type,
            tool_description=tool.description,
            enabled=binding.enabled,
            config_json=binding.config_json,
            created_at=binding.created_at,
        )

    async def unbind_tool(self, org: Organization, agent_id: int, tool_id: int) -> None:
        await self._ensure_agent_in_org(org, agent_id)
        binding = await self.repo.get_binding(agent_id, tool_id)
        if binding is None:
            raise AgentToolNotFound()
        await self.repo.delete_binding(binding)
        await self.db.commit()

    async def _ensure_agent_in_org(self, org: Organization, agent_id: int) -> None:
        agent = await self.agent_repo.get_by_id(agent_id)
        if agent is None or agent.organization_id != org.id:
            raise AgentNotFound()
