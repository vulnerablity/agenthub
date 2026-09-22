# api/v1/tools.py
# 工具接口（需求文档 3.7）：顶层路径 /tools + Agent 绑定子资源 /agents/{agent_id}/tools
# 组织隔离经 X-Organization-Id 请求头（require_header_org_role），工具归属校验在 ToolService 内完成
# 角色：写类端点 owner/admin，读类端点含 viewer（tool-calling.md 1 权限矩阵）
from typing import Annotated

from fastapi import APIRouter, Depends, Response

from app.api.deps import CurrentUser, DbSession, require_header_org_role
from app.models import Organization, OrganizationMember
from app.schemas.tool import (
    AgentToolBindRequest,
    AgentToolDetail,
    AgentToolUpdateRequest,
    ToolCreateRequest,
    ToolDetail,
    ToolTestRequest,
    ToolTestResponse,
    ToolUpdateRequest,
)
from app.services.tool_service import ToolService

# 工具 CRUD/测试：顶层 /tools
router = APIRouter(prefix="/tools", tags=["tools"])
# Agent 绑定子资源：顶层 /agents/{agent_id}/tools（独立 router，避免受 /tools prefix 影响）
agent_tools_router = APIRouter(prefix="/agents", tags=["tools"])

# 组织作用域别名（组织 ID 来自请求头，路径不含 org）：依赖内部完成校验并返回 (org, membership)
OrgCtx = Annotated[
    tuple[Organization, OrganizationMember],
    Depends(require_header_org_role("owner", "admin", "member", "viewer")),
]
AdminCtx = Annotated[
    tuple[Organization, OrganizationMember],
    Depends(require_header_org_role("owner", "admin")),
]


# ---------- 工具 CRUD（需求 3.7 + 补充） ----------


@router.post("", response_model=ToolDetail, status_code=201)
async def create_tool(
    data: ToolCreateRequest, ctx: AdminCtx, user: CurrentUser, db: DbSession
) -> ToolDetail:
    org, _ = ctx
    return await ToolService(db).create_tool(org, user.id, data)


@router.get("", response_model=list[ToolDetail])
async def list_tools(ctx: OrgCtx, db: DbSession) -> list[ToolDetail]:
    org, _ = ctx
    return await ToolService(db).list_tools(org)


@router.get("/{tool_id}", response_model=ToolDetail)
async def get_tool(tool_id: int, ctx: OrgCtx, db: DbSession) -> ToolDetail:
    org, _ = ctx
    return await ToolService(db).get_tool(org, tool_id)


@router.patch("/{tool_id}", response_model=ToolDetail)
async def update_tool(
    tool_id: int, data: ToolUpdateRequest, ctx: AdminCtx, db: DbSession
) -> ToolDetail:
    org, _ = ctx
    return await ToolService(db).update_tool(org, tool_id, data)


@router.delete("/{tool_id}", status_code=204)
async def delete_tool(tool_id: int, ctx: AdminCtx, db: DbSession) -> Response:
    org, _ = ctx
    await ToolService(db).delete_tool(org, tool_id)
    return Response(status_code=204)


# ---------- 工具测试（需求 3.7） ----------


@router.post("/{tool_id}/test", response_model=ToolTestResponse)
async def test_tool(
    tool_id: int, data: ToolTestRequest, ctx: AdminCtx, db: DbSession
) -> ToolTestResponse:
    org, _ = ctx
    return await ToolService(db).test_tool(org, tool_id, data)


# ---------- Agent 绑定（需求 3.7 / 4.7；挂 /agents prefix 的独立 router） ----------


@agent_tools_router.get("/{agent_id}/tools", response_model=list[AgentToolDetail])
async def list_agent_tools(
    agent_id: int, ctx: OrgCtx, db: DbSession
) -> list[AgentToolDetail]:
    org, _ = ctx
    return await ToolService(db).list_agent_tools(org, agent_id)


@agent_tools_router.post(
    "/{agent_id}/tools", response_model=AgentToolDetail, status_code=201
)
async def bind_agent_tool(
    agent_id: int, data: AgentToolBindRequest, ctx: AdminCtx, db: DbSession
) -> AgentToolDetail:
    org, _ = ctx
    return await ToolService(db).bind_tool(
        org, agent_id, data.tool_id, data.enabled, data.config_json
    )


@agent_tools_router.patch("/{agent_id}/tools/{tool_id}", response_model=AgentToolDetail)
async def update_agent_tool(
    agent_id: int,
    tool_id: int,
    data: AgentToolUpdateRequest,
    ctx: AdminCtx,
    db: DbSession,
) -> AgentToolDetail:
    org, _ = ctx
    return await ToolService(db).update_binding(org, agent_id, tool_id, data)


@agent_tools_router.delete("/{agent_id}/tools/{tool_id}", status_code=204)
async def unbind_agent_tool(
    agent_id: int, tool_id: int, ctx: AdminCtx, db: DbSession
) -> Response:
    org, _ = ctx
    await ToolService(db).unbind_tool(org, agent_id, tool_id)
    return Response(status_code=204)
