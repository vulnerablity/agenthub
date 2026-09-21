# AI Chat 对话模块开发方案

> 本文档描述 AI Chat 对话模块的**当前实际实现**，以代码为准，供后期维护与迭代参考。体例沿用《Agent 智能体管理模块设计文档》（`docs/模块设计文档/agent.md`）。
> 修订记录：初稿评审后修订 4 项必改（D6 版本绑定会话 / D11 并发互斥 / D12 查询层组织过滤 / 2.5 中断职责分层）+ 4 项建议改（增量输出措辞 / 新增 4 个测试 / Agent 删除生命周期 D14 / LLM 空输出 D13），全部已落地。
> 需求依据：`docs/需求文档 V1.0.md` 第 3.5（AI Chat 对话）、5.1（用户聊天流程）、4.11/4.12（数据表）及第 7 节 V1 开发范围（Chat + SSE 为必做；RAG / Tool Calling / Execution Log 为独立模块，不在本模块范围，仅预留编排挂点）。

## 1. 模块概述

功能清单：

- 会话：创建会话、会话列表（含 Agent 名与最后消息摘要）、删除会话
- 对话：发送消息（同步 + SSE 流式两种模式）、加载历史消息、流式输出过程中可中止
- 消息：用户/助手消息落库（含 token_usage），刷新后可恢复历史

产品决策（基线，改动需同步本文档）：

| # | 决策 | 说明 |
| --- | --- | --- |
| D1 | 会话归属**用户私有**：仅创建者可访问其会话，他人（含同组织 owner）访问一律 404 | 需求 4.11 conversations 含 user_id；不泄露会话存在性，沿用 agents 模块 404 约定 |
| D2 | 会话标题自动生成：取首条用户消息前 30 字符；创建时允许显式指定 title | 需求 4.11 含 title，未定义来源 |
| D3 | V1 对话编排为「加载会话绑定的 Agent 版本快照 → 直接调用 LLM」，RAG 检索 / Tool 调用以 pipeline 扩展点预留（空步骤列表） | 需求 3.5 仅要求对话与 SSE；5.1 的 4–6 步属知识库 / 工具模块完成后接入 |
| D4 | SSE 事件协议与需求 3.5 对齐：`message`（增量文本）+ `done`（汇总），另加 `error`（流中失败） | 需求文档示例即此形态，不另造 delta 事件 |
| D5 | 用户消息在请求开始时落库；助手消息**流式结束一次性落库**（含 token_usage）；流中异常时助手消息不落库，用户消息保留 | 避免逐 token 写库；失败时可整体重试 |
| D6 | **会话创建时绑定版本快照**：`conversations.agent_version_id = 创建时的 agents.current_version_id`，整个会话生命周期固定使用该版本，发布 / 回滚不影响存量会话；Agent 未启用或无发布版本 → `AGENT_NOT_AVAILABLE` | 评审修订：避免同一会话上下文跨版本、保证「回答由哪个版本生成」可追溯。需求 4.11 未含此字段，属架构增强 |
| D7 | 需求 3.5 仅列 3 个接口，为满足「查看历史会话」权限与页面可用性，补充列表 / 历史消息 / 会话详情 / 删除 4 个 REST 接口 | 补充接口以「需求补充」标注 |
| D8 | 对话权限：owner / admin / member 可创建会话与对话；viewer 只读（不可发起对话） | 对齐需求 2.1 / 2.4 角色矩阵 |
| D9 | LLM 接入统一走 OpenAI 兼容协议（`/chat/completions` + `stream=true`）；网关地址全局配置，模型名由**会话绑定的版本**决定 | 兼容 OpenAI / DeepSeek / Qwen 等；provider 字段仅存值、V1 全部按兼容协议处理 |
| D10 | 助手消息前端以 Markdown 渲染（引入 react-markdown），不支持公式/图片 | 助手输出本质为 Markdown；代码块做基础样式 |
| D11 | 同一会话**同时只允许一个进行中的生成**，重入请求 409 `CONVERSATION_BUSY`；V1 用进程内 per-conversation asyncio 锁（本服务单进程部署；多副本时升级 Redis 锁） | 评审修订：防止并发双流导致上下文不一致 |
| D12 | 组织隔离**贯穿查询层**：列表 / 详情 / 历史均校验会话经 `agent.organization_id` 归属当前组织，不符返回 404 | 评审修订：用户可属多组织，仅按 user_id 过滤会跨租户泄露 |
| D13 | LLM 空输出（无任何 delta）不落库 assistant 消息，`done.message_id=null`，前端提示「模型未返回内容」 | 防止空内容消息污染历史 |
| D14 | Agent 硬删除 → 会话 / 消息随 `agent_id` 级联删除（与 Agent 模块物理删除策略一致，见 agent.md D6）；Agent 改软删除时需复审本策略 | 评审确认：级联清理作为明确产品行为 |

前后端对应关系：

| 功能 | 后端接口 | 前端实现 |
| --- | --- | --- |
| 创建会话 | `POST /api/v1/conversations` | `api/conversations.ts` → 对话页「新建」/ Agent 卡片「对话」按钮 |
| 会话列表 | `GET /api/v1/conversations` `?agent_id=` | `hooks/useConversations.ts` → 对话页左侧列表 |
| 会话详情 | `GET /api/v1/conversations/{id}` | `hooks/useConversation.ts` |
| 删除会话 | `DELETE /api/v1/conversations/{id}`（需求补充） | 会话列表项「删除」 |
| 历史消息 | `GET /api/v1/conversations/{id}/messages`（需求补充） | `hooks/useConversationMessages.ts` |
| 发送消息（同步） | `POST /api/v1/conversations/{id}/messages` | 测试 / 非流式回退（前端默认不用） |
| 流式聊天 | `POST /api/v1/conversations/{id}/stream`（SSE） | `utils/sse.ts` + `hooks/useChatStream.ts` → 对话页主链路 |

权限矩阵（组织内，后端为准、前端按角色隐藏入口）：

| 操作 | owner | admin | member | viewer |
| --- | --- | --- | --- | --- |
| 查看自己的会话 / 历史消息 | ✔ | ✔ | ✔ | ✔ |
| 创建会话 / 发送消息（对话） | ✔ | ✔ | ✔ | — |
| 删除自己的会话 | ✔ | ✔ | ✔ | ✔ |

组织隔离沿用项目约定：顶层路径 `/conversations`，组织 ID 经 `X-Organization-Id` 请求头，后端用 `require_header_org_role` 校验（头缺失/非数字 → 403，会话不归属 → 404）。

## 2. 后端实现

### 2.1 目录结构与分层

沿用 Router → Service → Repository → DB 分层；LLM 为外部集成放 `integrations/`，Service 编排、不直接触网。

```
backend/
├─ alembic/versions/20260921_0004_create_chat_tables.py   # conversations + messages
├─ app/
│  ├─ api/v1/conversations.py    # 7 个端点（顶层 prefix=/conversations）
│  ├─ api/v1/router.py           # 挂载 conversations.router
│  ├─ core/config.py             # 新增 LLM_API_BASE / LLM_API_KEY / LLM_TIMEOUT_SECONDS / CHAT_HISTORY_LIMIT
│  ├─ core/exceptions.py         # 新增 ConversationNotFound / AgentNotAvailable / MessageContentRequired / LLMUpstreamError / LLMTimeout
│  ├─ integrations/__init__.py   # 新建目录
│  ├─ integrations/llm.py        # LLMClient：OpenAI 兼容流式调用（httpx），模块级单例
│  ├─ models/conversation.py     # Conversation（对齐需求 4.11）
│  ├─ models/message.py          # Message（对齐需求 4.12）
│  ├─ models/__init__.py         # 追加导出 Conversation / Message
│  ├─ schemas/chat.py            # 请求 / 响应模型 + SSE 事件数据模型
│  ├─ repositories/conversation_repo.py   # conversations / messages 数据访问
│  └─ services/chat_service.py   # 会话 CRUD + 消息发送编排（pipeline 扩展点）
```

### 2.2 数据模型（对齐需求 4.11 / 4.12）

`conversations`：

| 字段 | 类型 | 约束 / 索引 |
| --- | --- | --- |
| id | BIGINT | 主键自增 |
| user_id | BIGINT | FK users.id，NOT NULL |
| agent_id | BIGINT | FK agents.id，NOT NULL，`ON DELETE CASCADE`（Agent 删除随会话清理，见 D14） |
| agent_version_id | BIGINT | FK agent_versions.id，NOT NULL，`ON DELETE SET NULL`；创建时快照自 agents.current_version_id（D6，需求扩充，评审采纳） |
| title | VARCHAR(200) | NOT NULL |
| created_at / updated_at | DATETIME | server_default=func.now()；updated_at 用于列表排序 |

索引：`ix_conversations_user_updated(user_id, updated_at)`、`ix_conversations_agent(agent_id)`。

`messages`：

| 字段 | 类型 | 约束 / 索引 |
| --- | --- | --- |
| id | BIGINT | 主键自增 |
| conversation_id | BIGINT | FK conversations.id，NOT NULL，`ON DELETE CASCADE`，索引 |
| role | VARCHAR(20) | `user` / `assistant`（亦可存 `system` 备用） |
| content | TEXT | NOT NULL |
| token_usage | JSON | 可空；流式结束后写入 `{prompt_tokens, completion_tokens, total_tokens}` |
| metadata_json | JSON | 可空；预留（模型名、provider、耗时等） |
| created_at | DATETIME | server_default=func.now() |

说明：执行日志 `agent_execution_logs` / `llm_usage_logs`（需求 4.13/4.14）属 3.8 执行监控模块，**本模块不建表**；token_usage 仅落在 messages，执行监控模块落地后再行归档。

### 2.3 接口设计

全部端点挂 `require_header_org_role("owner", "admin", "member", "viewer")` 依赖（组织存在 + 成员身份的公共前提）；会话级校验在 `ChatService` 内完成，**双条件**：会话归属当前用户（D1）且会话经 agent 归属当前组织（D12），任一不满足一律 404：

> 校验实现：`JOIN agents` 取 `organization_id` 与请求头组织比对，而非仅比对 `conversations.user_id`。用户属多组织时（User 100 ∈ Org A + Org B），携带 `X-Organization-Id: A` 的列表请求不得出现 Org B 的会话。

- `POST /conversations`（需求 3.5）→ 201

  Request `{agent_id: int, title?: string}`；校验 Agent 属当前组织且已启用、有当前发布版本（404/409）→ 读取 `agents.current_version_id` 快照写入 `agent_version_id` → 创建会话（D6）。
- `GET /conversations?agent_id=&limit=&offset=`（需求补充）→ 会话列表

  返回当前用户的会话，**查询层过滤组织**（D12）：`JOIN agents WHERE c.user_id = :uid AND a.organization_id = :org_id`；`JOIN agents` 同时返回 `agent_name` / `agent_avatar_url`；子查询带出 `last_message_preview`（50 字）与 `last_message_at`；按 `updated_at` 倒序。
- `GET /conversations/{id}`（需求补充）→ 会话详情（含 agent_name / agent_id / agent_version_id），双条件校验（D1 + D12）
- `DELETE /conversations/{id}`（需求补充）→ 204，消息随 CASCADE 清理，双条件校验（D1 + D12）
- `GET /conversations/{id}/messages?limit=&before_id=`（需求补充）→ 历史消息

  按 id 升序切页（`before_id` 向上翻更早消息），V1 默认全量返回（limit 上限 200）。
- `POST /conversations/{id}/messages`（需求 3.5）→ 同步发送

  Request `{content: str}`，1–10000 字符；Response 为完整 MessageDetail（非流式，直接返回 LLM 完整结果）。语义与 stream 等价，供自动化 / 回退使用。
- `POST /conversations/{id}/stream`（需求 3.5）→ `text/event-stream`

  Request 同上。响应头 `Content-Type: text/event-stream; charset=utf-8`、`Cache-Control: no-cache`、`X-Accel-Buffering: no`。

权限与错误语义：

| 场景 | 状态码 / 错误码 |
| --- | --- |
| 会话不存在 / 不属于当前用户 / agent 不属于当前组织 | 404 `CONVERSATION_NOT_FOUND` |
| Agent 不存在 / 不属于当前组织 / 未启用 / 无发布版本 | 404 `AGENT_NOT_FOUND`（跨租户不泄露）或 409 `AGENT_NOT_AVAILABLE` |
| 会话已有进行中的生成（并发发送） | 409 `CONVERSATION_BUSY`（D11） |
| content 为空 / 超长 | 400 `MESSAGE_CONTENT_REQUIRED` / `MESSAGE_CONTENT_TOO_LONG` |
| LLM 上游失败 / 超时 | 流前 502 `LLM_UPSTREAM_ERROR`；流中发 `error` 事件 |

创建会话与同步发送接口不做角色细分（依赖已限定成员及以上；viewer 由依赖白名单排除——viewer 不可对话，见 D8，依赖参数按端点区分：对话类端点 `("owner","admin","member")`，只读类端点含 `"viewer"`）。

### 2.4 SSE 事件协议（对齐需求 3.5）

```
event: message
data: {"delta": "你好"}

data: {"delta": "，世界"}

event: done
data: {"message_id": 12, "token_usage": {"prompt_tokens": 21, "completion_tokens": 9, "total_tokens": 30}}
```

流中失败：

```
event: error
data: {"code": "LLM_UPSTREAM_ERROR", "message": "上游 LLM 调用失败"}
```

约束：

- 每个 `message` 事件一个 `delta` 片段；客户端按序拼接。
- `done` 为终止事件，携带落库后的助手消息 id 与 token_usage；LLM 空输出时 `message_id=null`（D13），客户端视为无有效回答。
- 权限 / 会话校验失败发生在流开始前，直接返回统一 JSON 业务错误（不走 SSE）。
- 异常兜底：生成器捕获所有异常并将 `error` 事件作为最后一个事件（用户消息已落库，可重试）。

### 2.5 LLM 客户端（integrations/llm.py）

- 配置：`core/config.py` 新增 `LLM_API_BASE`（如 `https://api.deepseek.com/v1`）、`LLM_API_KEY`、`LLM_TIMEOUT_SECONDS=60`。
- `LLMClient` 用 `httpx.AsyncClient`（池化、超时两级：连接 + 读超时），请求 `/chat/completions`、`stream=true`。
- 核心方法：

```python
# integrations/llm.py
# ChatRuntimeError 基类：后续 RAG 检索 / Tool 调用失败同样归一到此类

class LLMClient:
    async def chat_stream(
        self,
        *,
        messages: list[dict[str, str]],
        model: str,
        temperature: float = 0.7,
        max_tokens: int | None = None,
    ) -> AsyncIterator[dict]:
        """逐条产出 {"delta": str} 与收尾 {"usage": {...}}，透明处理上游 SSE 解析"""
```

- 上游流式 usage：请求带 `stream_options={"include_usage": True}`；上游不支持时 usage 为空，落库时留空。
- **职责边界**：`LLMClient` 为纯基础设施组件，只负责 HTTP 调用 / 上游 SSE 解析 / 产出 delta，**不依赖 FastAPI `Request`、不感知客户端断开**；取消以 asyncio 任务取消语义向上收敛（见 2.6）。上游流必须通过 `async with client.stream(...)` 上下文管理，任务被取消时由上下文自动关闭连接，`LLMClient` 自身无需任何 FastAPI 依赖，后续 RAG / Tool / Agent Runtime 可直接复用。

### 2.6 对话编排（services/chat_service.py）

`stream_message(org, user, conversation_id, data)` 流程（对应需求 5.1，RAG/Tool 步骤以空列表占位）：

```python
# services/chat_service.py
# 编排骨架：V1 pipeline_steps 为空列表；知识库/工具模块落地后注入 rag_retrieve / tool_call 步骤
# 1. 会话双条件校验：归属当前用户（D1）+ agent 归属当前组织（D12），任一不符 → 404
# 2. 并发互斥：非阻塞获取会话级 asyncio 锁（进程内 dict[int, Lock]），已占用 → 409 CONVERSATION_BUSY（D11）
# 3. 校验 Agent 启用状态（disabled → 409 AGENT_NOT_AVAILABLE，启停即时生效对齐 agent 模块 D5）；加载会话绑定的版本快照 conversations.agent_version_id（D6），取 system_prompt / 模型参数
# 4. 组装上下文消息（历史最近 CHAT_HISTORY_LIMIT=20 条 + 本次用户输入）
# 5. 落库用户消息（role=user）
# 6. 依序执行 pipeline_steps（V1 为空）
# 7. LLMClient.chat_stream 逐 delta 产出 → 生成器逐事件转发
# 8. 收尾：LLM 空输出不落库（D13）；否则落库助手消息 + token_usage；更新会话 updated_at 与标题（首轮）；finally 释放并发锁
# 9. 异常：流前抛 AppError（统一 JSON）；流中产出 error 事件并中止
```

生成器函数（`async def sse_generator()`）作为 `StreamingResponse` 内容直接返回，`ChatService` 内以方法产出、`api` 层只做包装，保持 Router 层薄。

**中断收敛路径（评审修订）**：客户端断开 →

```text
Starlette 取消 StreamingResponse 生成器任务
        ↓
sse_generator 收到 asyncio.CancelledError
        ↓
finally：释放会话锁、关闭 httpx 上游流（async with 自动收敛）
```

`LLMClient` 不接触 FastAPI `Request`；断流后用户消息已落库、助手消息不落库，重试即从断点语义恢复。

## 3. 前端实现

### 3.1 目录结构

```
frontend/src/
├─ api/conversations.ts         # REST 封装（体例对齐 api/agents.ts）
├─ api/index.ts                 # 追加导出 conversationApi
├─ utils/sse.ts                 # fetch SSE 解析器：POST + ReadableStream + 按事件分发
├─ hooks/useConversations.ts    # 会话列表（React Query）
├─ hooks/useConversation.ts     # 会话详情（含 agent 信息）
├─ hooks/useConversationMessages.ts  # 历史消息
├─ hooks/useChatStream.ts       # 发送状态机 + 中止（AbortController）
├─ pages/chat/Chat.tsx          # 对话页（两态：无会话 = 欢迎态；有会话 = 聊天态）
├─ components/chat/SessionList.tsx   # 左侧会话列表（新建 / 切换 / 删除）
├─ components/chat/MessageBubble.tsx # 消息气泡（用户右 / 助手左，Markdown 渲染）
├─ components/chat/ChatInput.tsx     # 输入区（自适应高度 textarea + 发送 / 停止）
└─ constants/routes.ts          # 追加 CHAT / CHAT_CONVERSATION 路径与生成函数
```

依赖变更：`package.json` 新增 `react-markdown`（D10）。

### 3.2 路由与入口

- `/organizations/:orgId/chat`：对话页（无选中会话，欢迎态 + 会话列表）
- `/organizations/:orgId/chat/:conversationId`：对话页（选中会话）

入口（三处）：

1. 侧边栏「AI 对话」菜单（`agentsPath` 同款组织内禁用逻辑），指向 `chatPath(currentOrgId)`
2. Agent 列表卡片「对话」按钮：`POST /conversations` 创建后跳 `/chat/{id}`
3. Agent 详情页操作栏「开始对话」按钮：行为同上

### 3.3 页面布局（Chat.tsx）

```
┌────────────┬──────────────────────────────────┬───────────────┐
│ 会话列表    │ 头部：Agent 名 + 当前版本精致徽标   │（预留）        │
│ 新建会话 +  │                                  │  执行链路      │
│ 搜索       │  消息流（斑马滚动区）               │  面板         │
│ 会话项      │   用户气泡（右，primary 底）       │  （V1 隐藏，  │
│ （标题/     │   助手气泡（左，白底 Markdown）     │   3.8 落地后  │
│  摘要/时间）│                                  │   启用）      │
│            │  输入区：textarea + 发送/停止按钮   │               │
└────────────┴──────────────────────────────────┴───────────────┘
```

- 会话列表：新建按钮（创建后入列并选中）、按 last_message_at 倒序、删除（二次确认）
- 消息流：进入会话先加载历史（React Query），流式增量直接附加在临时 assistant 消息上；自动滚动到底（用户上翻时不强制）
- 输入区：Enter 发送 / Shift+Enter 换行；流式中按钮切换为「停止」（AbortController 中止，已收到的部分保留）
- 错误提示：流前错误（404/409/502）以气泡内错误条展示并可「重试」；409 `CONVERSATION_BUSY` 提示「回答生成中，请稍候」；流中 `error` 事件展示错误条

### 3.4 流式消费（utils/sse.ts + useChatStream.ts）

axios 不支持流式响应，SSE 走原生 fetch：

```ts
// utils/sse.ts
// POST + SSE 解析：仅处理 200；非 200 读取 JSON 抛统一 ApiError
// 401 复用 http.ts 暴露的登出回调（setOnUnauthorized 已注册的 handler），与 REST 行为一致
export async function postSse(
  url: string,
  body: unknown,
  handlers: { onMessage: (delta: string) => void; onDone: (payload: DonePayload) => void; onError: (err: SseError) => void },
  signal?: AbortSignal,
): Promise<void>
```

实现要点：

- 手动携带 `Authorization: Bearer ${token}` 与 `X-Organization-Id`（fetch 不经过 axios 拦截器；orgId 复用 http.ts 的 provider 逻辑抽出的公共函数）
- `TextDecoder` + 按空行分帧解析 `event:` / `data:` 行；响应提前结束视为流中错误
- `useChatStream` 状态机：`idle → streaming → done | error`；暴露 `send(content)`（先本地乐观追加用户气泡 + 落库后以服务端消息为准）、`stop()`
- 中止：`AbortController`，`stop()` 触发后本地保留已收部分并提示「已停止生成」

## 4. 数据库迁移

`20260921_0004_create_chat_tables.py`：建 `conversations`、`messages` 两表（字段与 2.2 一致，索引含 `ix_conversations_user_updated` / `ix_conversations_agent` / `ix_messages_conversation`）。执行方式沿用项目惯例：重建容器 + `alembic upgrade head`（后端目录内，DATABASE_URL 指向 13306）。

## 5. 测试与验收

后端 `tests/test_chat.py`（体例对齐 `test_agent.py`，LLM 侧以 `monkeypatch` 替换 `LLMClient.chat_stream` 为假流）：

- 会话：创建（含 title 自动截断、agent_version_id 快照正确）、列表仅见自己、跨用户访问 404、删除级联消息
- 组织隔离：同一用户属 Org A + Org B，携带 `X-Organization-Id: A` 的列表 / 详情 / 历史请求不出现 Org B 会话；跨组织直访会话 404（D12，评审新增）
- 版本快照：会话建于 v1 → 发布 v2 → 该会话继续对话仍使用 v1 的 system_prompt / 模型；新会话使用 v2（D6，评审新增）
- 权限：viewer 对话 403；无组织头 403；非成员 403
- 并发：同一会话并发两次 stream，其一 409 `CONVERSATION_BUSY`；流结束后锁释放可再发（D11，评审新增）
- 发送：空 content 400；Agent 未启用 / 无版本 409
- 流式：`AsyncClient(transport=ASGITransport)` 读流，断言 `message` 事件序列与 `done` 载荷（message_id、token_usage）；模拟流中异常断言 `error` 事件；模拟客户端断开断言中止且锁释放
- 空输出：LLM 无 delta → 不落库 assistant 消息，`done.message_id=null`（D13，评审新增）
- 落库：用户消息先落库；助手消息 done 后落库且 token_usage 正确

验收标准（对齐需求第 8 节 1–6 条中本模块部分）：

1. 组织内 owner/admin/member 可选择 Agent 开始对话，viewer 不可
2. 消息**流式增量输出**（按 `delta` 块顺序拼接，不承诺逐字）、可停止；完成后刷新页面历史完整
3. 会话列表展示标题（自动生成）、摘要与时间；可删除
4. 切换 / 重进会话历史不丢；禁用或无版本 Agent 拒绝对话且提示明确

## 6. 实施步骤

1. 迁移 + models + schemas + exceptions（`20260921_0004` 含 `conversations.agent_version_id`、`conversation.py`、`message.py`、`chat.py`）
2. `integrations/llm.py` + `core/config.py` 环境变量
3. `repositories/conversation_repo.py`（查询层组织过滤）+ `services/chat_service.py`（CRUD 先行，再编排流 + 并发锁）
4. `api/v1/conversations.py` + `router.py` 挂载；`tests/test_chat.py` 全绿
5. 前端 `api/conversations.ts`、`utils/sse.ts`、四个 hooks
6. 页面 `Chat.tsx` + 三个组件 + 路由 / 菜单 / Agent 卡片与详情入口；依赖 `react-markdown`
7. 联调：Docker 重建 + 迁移 → 注册组织用户 → 创建 Agent（发布 v1）→ 对话全链路验收