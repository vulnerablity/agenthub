# api/v1/executions.py
# 执行监控接口（需求文档 3.8）：顶层路径 /executions，组织隔离经 X-Organization-Id 请求头
# 权限（execution.md D3）：owner/admin 可见组织全部执行；member 仅本人发起；viewer 一律 403
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query

from app.api.deps import DbSession, require_header_org_role
from app.models import Organization, OrganizationMember
from app.schemas.execution import ExecutionDetail, ExecutionListResponse
from app.services.execution_service import ExecutionService

router = APIRouter(prefix="/executions", tags=["executions"])

# 组织作用域别名：viewer 不在允许角色内（403），member 范围由 Service 层按 user_id 收窄（D3）
ExecCtx = Annotated[
    tuple[Organization, OrganizationMember],
    Depends(require_header_org_role("owner", "admin", "member")),
]


@router.get("", response_model=ExecutionListResponse)
async def list_executions(
    ctx: ExecCtx,
    db: DbSession,
    agent_id: Annotated[int | None, Query()] = None,
    conversation_id: Annotated[int | None, Query()] = None,
    status: Annotated[Literal["success", "error"] | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> ExecutionListResponse:
    org, membership = ctx
    items, total = await ExecutionService(db).list_executions(
        org, membership, agent_id, conversation_id, status, limit, offset
    )
    return ExecutionListResponse(items=items, total=total)


@router.get("/{execution_id}", response_model=ExecutionDetail)
async def get_execution(
    execution_id: str, ctx: ExecCtx, db: DbSession
) -> ExecutionDetail:
    org, membership = ctx
    return await ExecutionService(db).get_execution(org, membership, execution_id)