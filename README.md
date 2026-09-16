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

## 🧪 Testing

```bash
cd backend

pytest
```

## 🐳 Development

Start infrastructure services:

```bash
docker compose up -d
```

Backend:

```bash
cd backend

pip install -r requirements.txt

uvicorn app.main:app --reload
```

Frontend:

```bash
cd frontend

npm install
npm run dev
```

## 📄 License

This project is licensed under the MIT License.
