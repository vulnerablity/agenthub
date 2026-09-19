# api/deps.py
# 公共依赖注入：数据库会话、当前用户、角色校验（RBAC 基础设施）
from collections.abc import AsyncGenerator
from typing import Annotated

from fastapi import Depends, Path
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import security
from app.core.exceptions import (
    Forbidden,
    NotOrgMember,
    OrganizationNotFound,
    TokenInvalid,
    UserInactive,
    UserNotFound,
)
from app.db.session import async_session_factory
from app.models import Organization, OrganizationMember, Role, User


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """提供数据库会话，请求结束自动关闭"""
    async with async_session_factory() as session:
        yield session


DbSession = Annotated[AsyncSession, Depends(get_db)]

_bearer_scheme = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: Annotated[
        HTTPAuthorizationCredentials | None, Depends(_bearer_scheme)
    ],
    db: DbSession,
) -> User:
    """解析 Bearer Access Token 并返回当前用户（校验签名/类型/有效期/账号状态）"""
    if credentials is None:
        raise TokenInvalid()
    payload = security.decode_token(credentials.credentials, expected_type="access")
    user = await db.get(User, int(payload["sub"]))
    if user is None:
        raise UserNotFound()
    if user.status != "active":
        raise UserInactive()
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_role(*allowed_roles: str):
    """依赖工厂：要求当前用户在任一组织拥有指定角色（供后续 RBAC 接口复用）"""

    async def role_checker(user: CurrentUser, db: DbSession) -> User:
        result = await db.execute(
            select(func.count(OrganizationMember.id))
            .join(Role, Role.id == OrganizationMember.role_id)
            .where(
                OrganizationMember.user_id == user.id,
                Role.name.in_(allowed_roles),
            )
        )
        if (result.scalar_one() or 0) == 0:
            raise Forbidden()
        return user

    return role_checker


def require_org_role(*allowed_roles: str):
    """组织作用域角色校验：组织存在、当前用户为该组织成员且角色命中。

    返回 (org, membership) 供 handler 复用，service 层不再重复查询成员关系。
    org_id 由 FastAPI 从路径注入（handler 不再重复声明）。
    """

    async def checker(
        org_id: Annotated[int, Path(description="组织 ID")],
        user: CurrentUser,
        db: DbSession,
    ) -> tuple[Organization, OrganizationMember]:
        org = await db.get(Organization, org_id)
        if org is None:
            raise OrganizationNotFound()
        result = await db.execute(
            select(OrganizationMember).where(
                OrganizationMember.organization_id == org_id,
                OrganizationMember.user_id == user.id,
            )
        )
        membership = result.scalar_one_or_none()
        if membership is None:
            raise NotOrgMember()
        # role 为 lazy="joined"，随 membership 查询一并加载
        if membership.role.name not in allowed_roles:
            raise Forbidden()
        return org, membership

    return checker
