# api/v1/router.py
# /api/v1 路由聚合：各业务模块在此挂载
from fastapi import APIRouter

from app.api.v1 import auth, organizations

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(organizations.router)
