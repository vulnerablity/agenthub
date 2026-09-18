# schemas/auth.py
# auth 模块请求/响应模型
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class RegisterRequest(BaseModel):
    """注册请求（密码最少 6 位，与需求示例一致）"""

    email: EmailStr
    username: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=6, max_length=128)


class RegisterResponse(BaseModel):
    id: int
    email: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int  # access token 有效期（秒）


class RefreshRequest(BaseModel):
    refresh_token: str


class OrganizationBrief(BaseModel):
    """当前用户所属组织及在该组织内的角色"""

    id: int
    name: str
    role: str


class MeResponse(BaseModel):
    """当前用户信息：用户 + 所属组织 + 权限"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    username: str
    avatar_url: str | None = None
    status: str
    created_at: datetime
    organizations: list[OrganizationBrief] = []