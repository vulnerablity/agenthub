# schemas/organization.py
# organization 模块请求/响应模型（组织 + 成员）
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field

# 角色名与 roles 表预置数据一致：owner / admin / member / viewer
OrgRoleName = Literal["owner", "admin", "member", "viewer"]
AssignableRoleName = Literal["admin", "member", "viewer"]


class OrganizationCreateRequest(BaseModel):
    """创建组织请求：名称 1–100 字符（前后端校验一致）"""

    name: str = Field(min_length=1, max_length=100)


class OrganizationUpdateRequest(BaseModel):
    """改名请求"""

    name: str = Field(min_length=1, max_length=100)


class OrganizationDetail(BaseModel):
    """组织详情：含 owner 信息、我的角色与成员数"""

    id: int
    name: str
    owner_id: int
    owner_username: str
    my_role: OrgRoleName
    member_count: int
    created_at: datetime


class OrganizationListItem(BaseModel):
    """我的组织列表项"""

    id: int
    name: str
    role: OrgRoleName
    owner_username: str
    member_count: int
    created_at: datetime


class MemberResponse(BaseModel):
    """成员信息（成员列表与增改响应共用）"""

    user_id: int
    email: str
    username: str
    avatar_url: str | None
    role: OrgRoleName
    joined_at: datetime


class MemberAddRequest(BaseModel):
    """添加成员请求：owner 角色只能通过转让变更，此处不可分配"""

    email: EmailStr
    role: AssignableRoleName = "member"


class MemberUpdateRequest(BaseModel):
    """修改成员角色请求：role=owner 即转让（仅 owner 可发起）"""

    role: OrgRoleName