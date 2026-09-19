# repositories/organization_repo.py
# organizations / organization_members 数据访问层（Service 层不直接写 SQL）
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import Organization, OrganizationMember, User


class OrganizationRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def get_by_id(self, org_id: int) -> Organization | None:
        return await self.db.get(Organization, org_id)

    async def get_membership(
        self, org_id: int, user_id: int
    ) -> OrganizationMember | None:
        """某用户在某组织的成员关系（user/role 一并加载，供权限判定与响应复用）"""
        result = await self.db.execute(
            select(OrganizationMember)
            .where(
                OrganizationMember.organization_id == org_id,
                OrganizationMember.user_id == user_id,
            )
            .options(
                selectinload(OrganizationMember.user),
                selectinload(OrganizationMember.role),
            )
        )
        return result.scalar_one_or_none()

    async def create(self, org: Organization) -> Organization:
        """新增组织并 flush 拿到自增 id"""
        self.db.add(org)
        await self.db.flush()
        return org

    async def add_member(self, membership: OrganizationMember) -> OrganizationMember:
        """新增成员关系并 flush 拿到自增 id"""
        self.db.add(membership)
        await self.db.flush()
        return membership

    async def list_by_user(self, user_id: int) -> list[OrganizationMember]:
        """当前用户全部成员关系（组织与角色一并加载，避免 N+1）"""
        result = await self.db.execute(
            select(OrganizationMember)
            .where(OrganizationMember.user_id == user_id)
            .options(
                selectinload(OrganizationMember.organization),
                selectinload(OrganizationMember.role),
            )
        )
        return list(result.scalars().all())

    async def list_memberships(
        self, org_id: int, email: str | None = None
    ) -> list[OrganizationMember]:
        """组织成员列表（含用户与角色）；可按邮箱模糊过滤"""
        stmt = (
            select(OrganizationMember)
            .where(OrganizationMember.organization_id == org_id)
            .options(
                selectinload(OrganizationMember.user),
                selectinload(OrganizationMember.role),
            )
            .order_by(OrganizationMember.created_at, OrganizationMember.id)
        )
        if email:
            stmt = stmt.where(
                OrganizationMember.user_id.in_(
                    select(User.id).where(User.email.like(f"%{email}%"))
                )
            )
        result = await self.db.execute(stmt)
        return list(result.scalars().all())

    async def owner_usernames(self, org_ids: list[int]) -> dict[int, str]:
        """批量取组织 owner 用户名"""
        result = await self.db.execute(
            select(Organization.id, User.username)
            .join(User, User.id == Organization.owner_id)
            .where(Organization.id.in_(org_ids))
        )
        return {org_id: username for org_id, username in result.all()}

    async def member_counts(self, org_ids: list[int]) -> dict[int, int]:
        """批量统计组织成员数"""
        result = await self.db.execute(
            select(OrganizationMember.organization_id, func.count())
            .where(OrganizationMember.organization_id.in_(org_ids))
            .group_by(OrganizationMember.organization_id)
        )
        return {org_id: count for org_id, count in result.all()}

    async def delete_member(self, membership: OrganizationMember) -> None:
        await self.db.delete(membership)

    async def delete_memberships(self, org_id: int) -> None:
        """解散组织前清空其全部成员关系"""
        await self.db.execute(
            delete(OrganizationMember).where(
                OrganizationMember.organization_id == org_id
            )
        )

    async def delete(self, org: Organization) -> None:
        await self.db.delete(org)
