# main.py
# 应用入口：装配 CORS、统一业务异常处理与 /api/v1 路由；lifespan 启动知识库文档处理 worker
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.v1.router import api_router
from app.core.config import settings
from app.core.exceptions import AppError
from app.services.document_worker import get_worker

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI):
    # ENCRYPTION_KEY 未配置软告警（model-providers.md D14）：允许启动，供应商密钥功能不可用
    if not settings.ENCRYPTION_KEY:
        logger.warning(
            "ENCRYPTION_KEY 未配置：模型供应商 api_key 功能不可用"
            "（生成：python -c \"from cryptography.fernet import Fernet; "
            "print(Fernet.generate_key().decode())\"）"
        )
    # 启动：恢复中断的文档任务并拉起消费循环（knowledge.md 3.4 重启恢复）
    await get_worker().start()
    yield
    await get_worker().stop()


app = FastAPI(
    title="AgentHub API",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(AppError)
async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    """统一业务异常响应格式：{code, message, detail}"""
    return JSONResponse(
        status_code=exc.status_code,
        content={"code": exc.code, "message": exc.message, "detail": None},
    )


app.include_router(api_router, prefix=settings.API_V1_PREFIX)


@app.get("/health")
async def health_check():
    return {"status": "ok"}
