# api/v1/agents.py
# 智能体接口：全部需登录且组织作用域（require_org_role 完成组织存在/成员身份/角色校验；
# 智能体归属校验在 AgentService 内完成）
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response

from app.api.deps import CurrentUser, DbSession, require_org_role
from app.models import Organization, OrganizationMember
from app.schemas.agent import (
    AgentCreateRequest,
    AgentDetail,
    AgentListItem,
    AgentStatus,
    AgentStatusRequest,
    AgentUpdateRequest,
)
from app.services.agent_service import AgentService

router = APIRouter(prefix="/organizations/{org_id}/agents", tags=["agents"])

# 组织作用域别名：依赖内部完成校验并返回 (org, membership)，handler 无需重复声明 org_id
OrgCtx = Annotated[
    tuple[Organization, OrganizationMember],
    Depends(require_org_role("owner", "admin", "member", "viewer")),
]
AdminCtx = Annotated[
    tuple[Organization, OrganizationMember],
    Depends(require_org_role("owner", "admin")),
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
