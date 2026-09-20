# services/organization_service.py
# 组织 CRUD 与成员管理业务逻辑（组织存在/成员身份/角色兜底在 api/deps.require_org_role）
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import (
    AlreadyMember,
    AppError,
    MemberManageForbidden,
    OrgMemberNotFound,
    OwnerCannotBeRemoved,
    OwnerCannotLeave,
    OwnerMustTransfer,
    OwnerRequired,
    RoleNotAssignable,
    SelfRoleChangeForbidden,
    UserNotFound,
)
from app.models import Organization, OrganizationMember, Role, User
from app.repositories.agent_repo import AgentRepository
from app.repositories.organization_repo import OrganizationRepository
from app.repositories.user_repo import UserRepository
from app.schemas.organization import (
    MemberAddRequest,
    MemberResponse,
    MemberUpdateRequest,
    OrganizationCreateRequest,
    OrganizationDetail,
    OrganizationListItem,
    OrganizationUpdateRequest,
)


class OrganizationService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.org_repo = OrganizationRepository(db)
        self.user_repo = UserRepository(db)
        self.agent_repo = AgentRepository(db)

    # ---------- 组织 ----------

    async def create_organization(
        self, user: User, data: OrganizationCreateRequest
    ) -> OrganizationDetail:
        """创建组织：同一事务内建组织 + 创建者成为 owner 成员"""
        owner_role = await self._get_role("owner")
        org = await self.org_repo.create(Organization(name=data.name, owner_id=user.id))
        await self.org_repo.add_member(
            OrganizationMember(
                organization_id=org.id, user_id=user.id, role_id=owner_role.id
            )
        )
        # refresh 取回 server_default 的 created_at（MySQL 无 RETURNING）
        await self.db.refresh(org)
        await self.db.commit()
        return await self._detail(org, "owner")

    async def list_my_organizations(self, user: User) -> list[OrganizationListItem]:
        """当前用户加入的全部组织（含角色、owner、成员数）"""
        memberships = await self.org_repo.list_by_user(user.id)
        if not memberships:
            return []
        org_ids = [m.organization_id for m in memberships]
        owners = await self.org_repo.owner_usernames(org_ids)
        counts = await self.org_repo.member_counts(org_ids)
        return [
            OrganizationListItem(
                id=m.organization.id,
                name=m.organization.name,
                role=m.role.name,
                owner_username=owners.get(m.organization.id, ""),
                member_count=counts.get(m.organization.id, 0),
                created_at=m.organization.created_at,
            )
            for m in memberships
        ]

    async def get_detail(
        self, org: Organization, membership: OrganizationMember
    ) -> OrganizationDetail:
        return await self._detail(org, membership.role.name)

    async def rename(
        self,
        org: Organization,
        membership: OrganizationMember,
        data: OrganizationUpdateRequest,
    ) -> OrganizationDetail:
        org.name = data.name
        await self.db.commit()
        return await self._detail(org, membership.role.name)

    async def dissolve(self, org: Organization) -> None:
        """解散：先删智能体、再清成员关系、最后删组织（遵守外键顺序，设计文档 D8）"""
        await self.agent_repo.delete_by_org(org.id)
        await self.org_repo.delete_memberships(org.id)
        await self.org_repo.delete(org)
        await self.db.commit()

    # ---------- 成员 ----------

    async def list_members(
        self, org: Organization, email: str | None = None
    ) -> list[MemberResponse]:
        return [
            self._member_response(m)
            for m in await self.org_repo.list_memberships(org.id, email)
        ]

    async def add_member(
        self,
        org: Organization,
        caller: OrganizationMember,
        data: MemberAddRequest,
    ) -> MemberResponse:
        """添加已注册用户；admin 不能授予 admin 角色"""
        if caller.role.name == "admin" and data.role == "admin":
            raise RoleNotAssignable()
        target = await self.user_repo.get_by_email(data.email)
        if target is None:
            raise UserNotFound()
        if await self.org_repo.get_membership(org.id, target.id):
            raise AlreadyMember()
        role = await self._get_role(data.role)
        membership = await self.org_repo.add_member(
            OrganizationMember(
                organization_id=org.id, user_id=target.id, role_id=role.id
            )
        )
        try:
            # refresh 取回 server_default 的 created_at；commit 兜底唯一约束冲突
            await self.db.refresh(membership)
            await self.db.commit()
        except IntegrityError as exc:
            await self.db.rollback()
            raise AlreadyMember() from exc
        return MemberResponse(
            user_id=target.id,
            email=target.email,
            username=target.username,
            avatar_url=target.avatar_url,
            role=data.role,
            joined_at=membership.created_at,
        )

    async def update_member(
        self,
        org: Organization,
        caller: OrganizationMember,
        user_id: int,
        data: MemberUpdateRequest,
    ) -> MemberResponse:
        """修改成员角色；role=owner 即转让（事务内同步 organizations.owner_id）"""
        target = await self.org_repo.get_membership(org.id, user_id)
        if target is None:
            raise OrgMemberNotFound()
        if data.role == "owner":
            await self._transfer(org, caller, target)
        else:
            await self._change_role(caller, target, data.role)
        await self.db.commit()
        return self._member_response(target)

    async def leave(self, membership: OrganizationMember) -> None:
        """本人退出组织；owner 不可直接退出"""
        if membership.role.name == "owner":
            raise OwnerCannotLeave()
        await self.org_repo.delete_member(membership)
        await self.db.commit()

    async def remove_member(
        self,
        org: Organization,
        caller: OrganizationMember,
        user_id: int,
    ) -> None:
        """移除成员（owner 受保护；admin 不可移除 admin）"""
        target = await self.org_repo.get_membership(org.id, user_id)
        if target is None:
            raise OrgMemberNotFound()
        if target.role.name == "owner":
            if target.user_id == caller.user_id:
                raise OwnerCannotLeave()
            raise OwnerCannotBeRemoved()
        if caller.role.name == "admin" and target.role.name == "admin":
            raise MemberManageForbidden()
        await self.org_repo.delete_member(target)
        await self.db.commit()

    # ---------- 内部 ----------

    async def _transfer(
        self, org: Organization, caller: OrganizationMember, target: OrganizationMember
    ) -> None:
        """owner 转让：目标升 owner、旧 owner 降 admin、同步 organizations.owner_id"""
        if caller.role.name != "owner":
            raise OwnerRequired()
        if target.user_id == caller.user_id:
            raise SelfRoleChangeForbidden()
        if target.role.name == "owner":
            raise RoleNotAssignable()
        owner_role = await self._get_role("owner")
        admin_role = await self._get_role("admin")
        # 直接赋值 relationship（非 role_id）：target.role 已加载，仅改外键不会更新已加载的关系对象
        target.role = owner_role
        caller.role = admin_role
        org.owner_id = target.user_id

    async def _change_role(
        self, caller: OrganizationMember, target: OrganizationMember, role_name: str
    ) -> None:
        """普通改角色：owner 可管理 admin/member/viewer；admin 仅可管理 member/viewer"""
        if target.user_id == caller.user_id:
            raise SelfRoleChangeForbidden()
        if target.role.name == "owner":
            raise OwnerMustTransfer()
        if caller.role.name == "admin":
            if target.role.name == "admin":
                raise MemberManageForbidden()
            if role_name == "admin":
                raise RoleNotAssignable()
        role = await self._get_role(role_name)
        # 直接赋值 relationship，保证响应中 role 为最新值
        target.role = role

    async def _get_role(self, name: str) -> Role:
        result = await self.db.execute(select(Role).where(Role.name == name))
        role = result.scalar_one_or_none()
        if role is None:
            # 预置角色缺失属数据异常，正常流程不应发生
            raise AppError(500, "ROLE_NOT_FOUND", "角色数据缺失，请联系管理员")
        return role

    async def _detail(self, org: Organization, my_role: str) -> OrganizationDetail:
        owner = await self.user_repo.get_by_id(org.owner_id)
        counts = await self.org_repo.member_counts([org.id])
        return OrganizationDetail(
            id=org.id,
            name=org.name,
            owner_id=org.owner_id,
            owner_username=owner.username if owner else "未知用户",
            my_role=my_role,
            member_count=counts.get(org.id, 0),
            created_at=org.created_at,
        )

    @staticmethod
    def _member_response(m: OrganizationMember) -> MemberResponse:
        # 仅用于 selectinload 加载了 user/role 的成员关系
        return MemberResponse(
            user_id=m.user_id,
            email=m.user.email,
            username=m.user.username,
            avatar_url=m.user.avatar_url,
            role=m.role.name,
            joined_at=m.created_at,
        )
