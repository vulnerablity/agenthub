# api/v1/agents.py
# 智能体接口（需求文档 3.3 / 3.4）：顶层路径 /agents，组织隔离经 X-Organization-Id 请求头
# 组织存在/成员身份/角色校验由 require_header_org_role 完成，智能体归属校验在 AgentService 内完成
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response

from app.api.deps import CurrentUser, DbSession, require_header_org_role
from app.models import Organization, OrganizationMember
from app.schemas.agent import (
    AgentCreateRequest,
    AgentDetail,
    AgentListItem,
    AgentStatus,
    AgentStatusRequest,
    AgentUpdateRequest,
    AgentVersionCreateRequest,
    AgentVersionItem,
)
from app.services.agent_service import AgentService

router = APIRouter(prefix="/agents", tags=["agents"])

# 组织作用域别名（组织 ID 来自请求头，路径不含 org）：依赖内部完成校验并返回 (org, membership)
OrgCtx = Annotated[
    tuple[Organization, OrganizationMember],
    Depends(require_header_org_role("owner", "admin", "member", "viewer")),
]
AdminCtx = Annotated[
    tuple[Organization, OrganizationMember],
    Depends(require_header_org_role("owner", "admin")),
]


@router.post("", response_model=AgentDetail, status_code=201)
async def create_agent(
    data: AgentCreateRequest, ctx: AdminCtx, user: CurrentUser, db: DbSession
) -> AgentDetail:
    org, _ = ctx
    return await AgentService(db).create_agent(org, user, data)


@router.get("", response_model=list[AgentListItem])
async def list_agents(
    ctx: OrgCtx,
    db: DbSession,
    name: Annotated[str | None, Query(max_length=100)] = None,
    status: Annotated[AgentStatus | None, Query()] = None,
) -> list[AgentListItem]:
    org, _ = ctx
    return await AgentService(db).list_agents(org, name, status)


@router.get("/{agent_id}", response_model=AgentDetail)
async def get_agent(agent_id: int, ctx: OrgCtx, db: DbSession) -> AgentDetail:
    org, _ = ctx
    return await AgentService(db).get_agent(org, agent_id)


@router.patch("/{agent_id}", response_model=AgentDetail)
async def update_agent(
    agent_id: int, data: AgentUpdateRequest, ctx: AdminCtx, db: DbSession
) -> AgentDetail:
    org, _ = ctx
    return await AgentService(db).update_agent(org, agent_id, data)


@router.patch("/{agent_id}/status", response_model=AgentDetail)
async def set_agent_status(
    agent_id: int, data: AgentStatusRequest, ctx: AdminCtx, db: DbSession
) -> AgentDetail:
    org, _ = ctx
    return await AgentService(db).set_status(org, agent_id, data)


@router.delete("/{agent_id}", status_code=204)
async def delete_agent(agent_id: int, ctx: AdminCtx, db: DbSession) -> Response:
    org, _ = ctx
    await AgentService(db).delete_agent(org, agent_id)
    return Response(status_code=204)


# ---------- 版本管理（需求文档 3.4） ----------


@router.get("/{agent_id}/versions", response_model=list[AgentVersionItem])
async def list_agent_versions(
    agent_id: int, ctx: OrgCtx, db: DbSession
) -> list[AgentVersionItem]:
    org, _ = ctx
    return await AgentService(db).list_versions(org, agent_id)


@router.post("/{agent_id}/versions", response_model=AgentVersionItem, status_code=201)
async def create_agent_version(
    agent_id: int,
    data: AgentVersionCreateRequest,
    ctx: AdminCtx,
    user: CurrentUser,
    db: DbSession,
) -> AgentVersionItem:
    org, _ = ctx
    return await AgentService(db).create_version(org, agent_id, user, data)


@router.post("/{agent_id}/versions/{version_id}/publish", response_model=AgentDetail)
async def publish_agent_version(
    agent_id: int, version_id: int, ctx: AdminCtx, db: DbSession
) -> AgentDetail:
    org, _ = ctx
    return await AgentService(db).publish_version(org, agent_id, version_id)


@router.post("/{agent_id}/versions/{version_id}/rollback", response_model=AgentDetail)
async def rollback_agent_version(
    agent_id: int, version_id: int, ctx: AdminCtx, db: DbSession
) -> AgentDetail:
    org, _ = ctx
    return await AgentService(db).rollback_version(org, agent_id, version_id)
