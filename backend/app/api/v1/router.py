# api/v1/router.py
# /api/v1 路由聚合：各业务模块在此挂载
from fastapi import APIRouter

from app.api.v1 import (
    agents,
    auth,
    conversations,
    executions,
    knowledge,
    organizations,
    tools,
)

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(organizations.router)
api_router.include_router(agents.router)
api_router.include_router(conversations.router)
api_router.include_router(knowledge.router)
api_router.include_router(tools.router)
api_router.include_router(tools.agent_tools_router)
api_router.include_router(executions.router)
