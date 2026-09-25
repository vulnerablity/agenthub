# AgentHub

> Enterprise AI Agent Platform with RAG, Tool Calling and Workflow.

AgentHub is a full-stack AI Agent platform designed for teams to build, configure, manage, and run AI Agents with enterprise knowledge bases, RAG, Tool Calling, streaming conversations, and execution monitoring.

## ✨ Features

- 🤖 AI Agent Builder

- 💬 Streaming Chat with SSE

- 📚 Knowledge Base

- 🔎 RAG & Vector Search

- 📄 PDF / Markdown / TXT document processing

- 🔧 Tool Calling

- 🧠 Agent Memory

- 🔐 Authentication & RBAC

- 📊 Execution Logs & Analytics

- 🐳 Dockerized Deployment

- 🔄 CI/CD

## 🏗️ Architecture

```text
                    ┌──────────────────────┐
                    │      React Web       │
                    │ React + TypeScript   │
                    │ Zustand + Tailwind   │
                    └──────────┬───────────┘
                               │ HTTPS / SSE
                               ▼
                    ┌──────────────────────┐
                    │       FastAPI        │
                    │ API / Auth / RBAC    │
                    │ Agent / RAG / Chat   │
                    └───────┬───────┬──────┘
                            │       │
                 ┌──────────┘       └──────────┐
                 ▼                             ▼
          ┌──────────────┐              ┌──────────────┐
          │    MySQL     │              │    Redis     │
          │  Business DB │              │ Cache / Queue│
          └──────────────┘              └──────┬───────┘
                                               │
                         ┌─────────────────────┼───────────────┐
                         ▼                     ▼               ▼
                    ┌─────────┐          ┌─────────┐     ┌─────────┐
                    │ Qdrant  │          │ Worker  │     │ LLM API │
                    │Vector DB│          │         │     │         │
                    └─────────┘          └─────────┘     └─────────┘
```

## 🛠️ Tech Stack

### Frontend

- React

- TypeScript

- Vite

- Tailwind CSS

- Zustand

- TanStack Query

- React Router

- SSE

### Backend

- Python

- FastAPI

- Pydantic

- SQLAlchemy 2.0

- Alembic

- MySQL

- Redis

### AI

- LLM API

- Embeddings

- RAG

- Qdrant

- Tool Calling

- Agent Runtime

### Engineering

- Docker

- Nginx

- GitHub Actions

- Pytest

## 📂 Project Structure

```text
agenthub/
├── backend/
│   ├── app/
│   │   ├── api/
│   │   ├── core/
│   │   ├── models/
│   │   ├── repositories/
│   │   ├── schemas/
│   │   ├── services/
│   │   ├── workers/
│   │   └── main.py
│   ├── migrations/
│   ├── tests/
│   ├── Dockerfile
│   └── requirements.txt
│
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── pages/
│   │   ├── services/
│   │   ├── stores/
│   │   ├── types/
│   │   └── utils/
│   ├── Dockerfile
│   └── package.json
│
├── docker-compose.yml
├── .env.example
├── .gitignore
└── README.md
```

## 🚀 Core Workflow

### 1. Create an Agent

Configure:

- System Prompt

- LLM Provider

- Model

- Temperature

- Max Tokens

- Knowledge Bases

- Tools

### 2. Build a Knowledge Base

```text
Document
   ↓
Parser
   ↓
Chunking
   ↓
Embedding
   ↓
Qdrant
```

### 3. Ask a Question

```text
User Question
      ↓
Query Embedding
      ↓
Vector Search
      ↓
Top-K Documents
      ↓
Context Construction
      ↓
LLM
      ↓
Answer + Sources
```

### 4. Tool Calling

```text
User
 ↓
Agent Runtime
 ↓
LLM
 ├── Answer
 │
 └── Tool Call
       ↓
   Tool Executor
       ↓
      Tool
       ↓
     Result
       ↓
      LLM
       ↓
    Answer
```

## 🔐 Security

AgentHub provides:

- JWT Authentication

- Organization-level isolation

- Role-Based Access Control

- Tool permissions

- Rate Limiting

- Tool execution timeout

- Agent execution limits

## 📈 Roadmap

### V1

- Project initialization

- Authentication

- Organization & RBAC

- Agent Management

- Agent Versioning

- LLM Chat

- SSE Streaming

- Knowledge Base

- RAG

- Source Citation

- Tool Calling

- Execution Logs

- Redis

- Docker

### V2

- Agent Memory

- Workflow Builder

- Multi-Agent

- API Keys

- Analytics Dashboard

- Prometheus / Grafana

## ⚡ Quick Start

> 以下命令均在仓库根目录执行；Windows 用户使用 `scripts/*.ps1` 一键脚本，Linux/macOS 用户按 Development 段的命令操作。

### 1. 配置环境变量

字段名与 `backend/app/core/config.py` 一一对应，模板为 `.env.example`：

```bash
# 复制模板为根目录 .env（供 docker compose / 部署使用）
# Windows PowerShell:  Copy-Item .env.example .env
# Linux/macOS:         cp .env.example .env
```

配置分工：

- 根目录 `.env`：供 `docker compose` / CI / 部署读取（MySQL 使用 `agenthub` 用户）。
- `backend/.env`：本地直接运行后端时优先读取（本机数据库/Redis 实际凭据），`config.py` 会先读它、再回退根目录 `.env`；两处字段名保持一致。若本机 MySQL 不是 `root/123456@localhost:3306`，请改 `backend/.env` 的 `MYSQL_*` 与 `DATABASE_URL`。
- LLM：`LLM_API_BASE` / `LLM_API_KEY` 必填（OpenAI 兼容网关），否则 LLM 对话与 RAG 不可用；旧字段名 `LLM_BASE_URL` 仍兼容。

### 2. 一键安装

```powershell
.\scripts\setup.ps1        # 创建 backend\.venv 并安装后端依赖 + 前端 npm install
```

### 3. 一键启动

```powershell
.\scripts\dev.ps1          # 拉起 redis+qdrant（docker compose）→ 自动建主库并迁移 → 启动后端(8000) + 前端(5173)
.\scripts\dev.ps1 -AllInfra    # 基础设施包含 docker MySQL（本机已有 MySQL 时不要加）
.\scripts\dev.ps1 -SkipInfra  # Docker 未运行时跳过基础设施（Redis/Qdrant 缺失时文档处理/向量检索不可用）
```

浏览器打开 <http://localhost:5173>（前端）、<http://127.0.0.1:8000/docs>（API 文档）。

### 4. 一键测试

```powershell
.\scripts\test.ps1
```

详见下方 [Testing](#-testing)。

## 🧪 Testing

```bash
cd backend
pytest
```

一键脚本（Windows）：

```powershell
.\scripts\test.ps1                       # 全量测试
.\scripts\test.ps1 -TestDb mysql+asyncmy://root:pass@host:3306/agenthub_test   # 指定测试库
.\scripts\test.ps1 -PytestArgs "-x -k auth"   # 透传 pytest 参数
```

**测试数据库说明**：

- `tests/conftest.py` 会自动创建测试库（默认 `agenthub_test`）并执行 alembic 迁移到 head，**无需手动初始化**；每个用例结束后自动清空业务数据。
- 默认要求本机 MySQL 运行在 `localhost:3306`，账号 `root/123456`（与 `backend/.env` 一致）。
- 其他环境用 `TEST_DATABASE_URL`（或脚本 `-TestDb`）覆盖测试库地址。

## 🐳 Development

Start infrastructure services:

```bash
docker compose up -d
```

Backend:

```bash
cd backend

pip install -r requirements.txt

# 首次启动前创建主库并迁移（Windows 上可用 .\scripts\dev.ps1 自动完成）
alembic upgrade head

uvicorn app.main:app --reload
```

Frontend:

```bash
cd frontend

npm install
npm run dev
```

Linux/macOS 用户如需与 Windows 脚本等价的一键体验，可按上述命令顺序执行：起基础设施 → `alembic upgrade head` → 启动后端 → 启动前端。

## 📄 License

This project is licensed under the MIT License.
