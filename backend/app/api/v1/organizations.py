# api/v1/organizations.py
# 组织与成员接口：全部需登录；组织级操作经 require_org_role 校验组织存在/成员身份/角色
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response

from app.api.deps import CurrentUser, DbSession, require_org_role
from app.models import Organization, OrganizationMember
from app.schemas.organization import (
    MemberAddRequest,
    MemberResponse,
    MemberUpdateRequest,
    OrganizationCreateRequest,
    OrganizationDetail,
    OrganizationListItem,
    OrganizationUpdateRequest,
)
from app.services.organization_service import OrganizationService

router = APIRouter(prefix="/organizations", tags=["organizations"])

# 组织作用域别名：依赖内部完成校验并返回 (org, membership)，handler 无需重复声明 org_id
OrgCtx = Annotated[
    tuple[Organization, OrganizationMember],
    Depends(require_org_role("owner", "admin", "member", "viewer")),
]
AdminCtx = Annotated[
    tuple[Organization, OrganizationMember],
    Depends(require_org_role("owner", "admin")),
]
OwnerCtx = Annotated[
    tuple[Organization, OrganizationMember], Depends(require_org_role("owner"))
]


@router.post("", response_model=OrganizationDetail, status_code=201)
async def create_organization(
    data: OrganizationCreateRequest, user: CurrentUser, db: DbSession
) -> OrganizationDetail:
    return await OrganizationService(db).create_organization(user, data)


@router.get("", response_model=list[OrganizationListItem])
async def list_my_organizations(
    user: CurrentUser, db: DbSession
) -> list[OrganizationListItem]:
    return await OrganizationService(db).list_my_organizations(user)


@router.get("/{org_id}", response_model=OrganizationDetail)
async def get_organization(ctx: OrgCtx, db: DbSession) -> OrganizationDetail:
    org, membership = ctx
    return await OrganizationService(db).get_detail(org, membership)


@router.patch("/{org_id}", response_model=OrganizationDetail)
async def update_organization(
    data: OrganizationUpdateRequest, ctx: AdminCtx, db: DbSession
) -> OrganizationDetail:
    org, membership = ctx
    return await OrganizationService(db).rename(org, membership, data)


@router.delete("/{org_id}", status_code=204)
async def delete_organization(ctx: OwnerCtx, db: DbSession) -> Response:
    org, _ = ctx
    await OrganizationService(db).dissolve(org)
    return Response(status_code=204)


@router.get("/{org_id}/members", response_model=list[MemberResponse])
async def list_members(
    ctx: OrgCtx,
    db: DbSession,
    email: Annotated[str | None, Query(max_length=255)] = None,
) -> list[MemberResponse]:
    org, _ = ctx
    return await OrganizationService(db).list_members(org, email)


@router.post("/{org_id}/members", response_model=MemberResponse, status_code=201)
async def add_member(data: MemberAddRequest, ctx: AdminCtx, db: DbSession) -> MemberResponse:
    org, membership = ctx
    return await OrganizationService(db).add_member(org, membership, data)


# 注意：/members/me 必须声明在 /members/{user_id} 之前，否则 "me" 会被后者按路径参数吞掉
@router.delete("/{org_id}/members/me", status_code=204)
async def leave_organization(ctx: OrgCtx, db: DbSession) -> Response:
    _, membership = ctx
    await OrganizationService(db).leave(membership)
    return Response(status_code=204)


@router.patch("/{org_id}/members/{user_id}", response_model=MemberResponse)
async def update_member(
    user_id: int, data: MemberUpdateRequest, ctx: AdminCtx, db: DbSession
) -> MemberResponse:
    org, membership = ctx
    return await OrganizationService(db).update_member(org, membership, user_id, data)


@router.delete("/{org_id}/members/{user_id}", status_code=204)
async def remove_member(user_id: int, ctx: AdminCtx, db: DbSession) -> Response:
    org, membership = ctx
    await OrganizationService(db).remove_member(org, membership, user_id)
    return Response(status_code=204)