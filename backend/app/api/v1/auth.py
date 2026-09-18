# api/v1/auth.py
# 用户认证接口：注册 / 登录 / 刷新 / 当前用户
from fastapi import APIRouter

from app.api.deps import CurrentUser, DbSession
from app.schemas.auth import (
    LoginRequest,
    MeResponse,
    RefreshRequest,
    RegisterRequest,
    RegisterResponse,
    TokenResponse,
)
from app.services.auth_service import AuthService

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=RegisterResponse, status_code=201)
async def register(data: RegisterRequest, db: DbSession) -> RegisterResponse:
    user = await AuthService(db).register(data)
    return RegisterResponse(id=user.id, email=user.email)


@router.post("/login", response_model=TokenResponse)
async def login(data: LoginRequest, db: DbSession) -> TokenResponse:
    return await AuthService(db).login(data)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(data: RefreshRequest, db: DbSession) -> TokenResponse:
    return await AuthService(db).refresh(data.refresh_token)


@router.get("/me", response_model=MeResponse)
async def me(current_user: CurrentUser, db: DbSession) -> MeResponse:
    return await AuthService(db).get_me(current_user.id)