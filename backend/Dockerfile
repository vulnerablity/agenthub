# =========================================
# AgentHub Backend 镜像
# 使用方式（CI 与 docker compose 均基于本文件构建）
#   docker build -t agenthub-backend ./backend
# =========================================

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# 先装依赖，利用镜像分层缓存（requirements.txt 不变则此层不重建）
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 业务代码与迁移文件
COPY app ./app
COPY alembic ./alembic
COPY alembic.ini ./alembic.ini

EXPOSE 8000

# 启动前自动执行数据库迁移，再启动 API 服务
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
