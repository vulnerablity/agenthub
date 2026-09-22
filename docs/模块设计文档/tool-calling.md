# Tool Calling 工具调用模块开发方案

> 本文档描述 Tool Calling 工具调用模块的开发方案，覆盖工具管理、Agent 绑定与对话中的自动工具调用。体例沿用《AI Chat 对话模块设计文档》（`docs/模块设计文档/chat.md`）。
> 需求依据：`docs/需求文档 V1.0.md` 第 3.7（Tool Calling）、4.6/4.7（tools / agent_tools 表）、5.1（用户聊天流程第 6 步「调用 Tool（如需要）」）及第 7 节 V1 开发范围（Tool Calling 必做）、第 8 节验收标准第 7 条「调用外部工具」。
> 承接关系：chat.md D3 已预留 pipeline 扩展点，本模块落地该扩展点；执行监控（3.8，agent_execution_logs / llm_usage_logs）为独立模块，本模块不建表，工具调用轨迹随消息 metadata 落库。

## 1. 模块概述

功能清单：

- 工具管理：创建、列表、详情、编辑、删除（组织级共享）
- 工具类型 V1：内置 **Calculator**（安全表达式求值）与 **HTTP**（通用 webhook）；Search / Weather 以 HTTP 类型的**前端预设模板**形式提供（预填 config，不写专用执行器）；Database 因安全风险高暂缓
- 工具测试：绑定前独立测试执行，验证工具可用性
- Agent 绑定：绑定 / 解绑 / 启用开关 / 绑定级 config 覆盖
- 对话调用：对话中 LLM 依工具 schema 自主决策调用工具，多轮循环直至产出最终回答

产品决策（基线，改动需同步本文档）：

| # | 决策 | 说明 |
| --- | --- | --- |
| D01 | type 枚举 `calculator` / `http`，pydantic Literal 校验（DB 不加 CHECK，对齐 knowledge 风格） | 需求 4.6 type VARCHAR；V1 范围用户已确认 |
| D02 | 工具名称组织内唯一 `uq_tool_name(organization_id, name)` | 对齐 KB 名称唯一策略 |
| D03 | `agent_tools` 唯一约束 `(agent_id, tool_id)`，防重复绑定 | 需求 4.7 |
| D04 | FK 级联：tools 不随组织 CASCADE（解散走 service 顺序删）；agent_tools.tool_id / agent_id `ondelete=CASCADE` | Agent 删除 / 工具删除自动清理绑定 |
| D05 | 绑定为 Agent 级（需求 4.7 agent_tools），**不进入 agent_versions 快照**；对话时实时读取 enabled=true 的绑定 | 与 RAG（版本级）不同，需求文档明确 Agent 级 |
| D06 | `schema` = 传给 LLM 的 input JSON Schema（function.parameters）；`config` = 执行器固定配置（http 有 url/method/headers/body；calculator config=null） | schema 决定 LLM 出参，config 决定执行目标 |
| D07 | `created_by` 允许 NULL | 预留系统预置工具 |
| D08 | `agent_tools.config_json` 非 null 时整体覆盖 tools.config（绑定级 override） | 如换 URL / 加自定义 header |
| D09 | Tool Calling 循环上限 5 轮，超限强制终结并标记 `max_rounds_reached` | 防 LLM 反复索要工具导致死循环 |
| D10 | 仅落 user + 最终 assistant 两条消息；中间 assistant(tool_calls) / tool 消息不写 messages 表，轨迹随 metadata_json.tool_calls 落库 | 3.8 执行日志为独立模块，本模块不建表 |
| D11 | 工具执行异常不抛出：捕获后作为 tool error 结果回传 LLM，降级不中断对话 | 工具失败由 LLM 解释并继续回答 |
| D12 | 组织隔离沿用项目约定：顶层路径 `/tools`，`X-Organization-Id` 请求头，跨组织访问 404 `TOOL_NOT_FOUND` | 不泄露工具存在性 |

前后端对应关系：

| 功能 | 后端接口 | 前端实现 |
| --- | --- | --- |
| 工具列表 / 创建 / 详情 / 编辑 / 删除 | `GET/POST /api/v1/tools`、`GET/PATCH/DELETE /api/v1/tools/{tool_id}` | `api/tools.ts` + `hooks/useTools.ts` → 工具管理页 |
| 工具测试 | `POST /api/v1/tools/{tool_id}/test` | 工具详情页「测试运行」表单 |
| 绑定 / 解绑 / 开关 | `GET/POST /api/v1/agents/{agent_id}/tools`、`PATCH/DELETE /api/v1/agents/{agent_id}/tools/{tool_id}` | `hooks/useAgentTools.ts` → Agent 详情页「工具」区块 |
| 对话中工具调用 | SSE 新增 `tool_call` / `tool_result` 事件 + `done.tool_calls` | `utils/sse.ts` + `useChatStream.ts` + 对话页工具 chip / MessageBubble 轨迹 |

权限矩阵（组织内，后端为准、前端按角色隐藏入口）：

| 操作 | owner | admin | member | viewer |
| --- | --- | --- | --- | --- |
| 查看工具列表 / 详情 / 绑定列表 | ✔ | ✔ | ✔ | ✔ |
| 创建 / 编辑 / 删除工具 | ✔ | ✔ | — | — |
| 工具测试 | ✔ | ✔ | — | — |
| 绑定 / 解绑 / 开关 | ✔ | ✔ | — | — |

## 2. 后端实现

### 2.1 目录结构与分层

沿用 Router → Service → Repository → DB 分层；工具执行器为基础设施放 `integrations/`（可被 Chat 编排复用，不依赖 FastAPI）：

```
backend/
├─ alembic/versions/20260922_0006_create_tool_tables.py   # tools + agent_tools
├─ app/
│  ├─ api/v1/tools.py            # 顶层 /tools 端点 + /agents/{id}/tools 绑定子资源
│  ├─ api/v1/agents.py           # 绑定子资源也可挂此文件（实现时二选一，见 2.3）
│  ├─ api/v1/router.py           # 挂载 tools.router
│  ├─ core/exceptions.py         # 新增 Tool 域错误码
│  ├─ integrations/tool_runners.py   # 执行器注册表 + calculator/http 执行器 + openai schema 转换
│  ├─ integrations/llm.py        # 扩展 chat_stream 支持 tools 参数与 tool_calls 解析
│  ├─ models/tool.py             # Tool + AgentTool
│  ├─ models/__init__.py         # 追加导出
│  ├─ schemas/tool.py            # 工具域请求 / 响应模型 + ToolType + 绑定模型
│  ├─ schemas/chat.py            # SseDonePayload 增 tool_calls；新增 ToolCallRun
│  ├─ repositories/tool_repo.py  # tools / agent_tools 数据访问
│  ├─ services/tool_service.py   # 工具 CRUD / 测试 / 绑定编排 + delete_by_org
│  ├─ services/chat_service.py   # Tool Calling 循环（_agent_loop）
│  └─ services/organization_service.py  # dissolve 插入工具清理
```

### 2.2 数据模型（对齐需求 4.6 / 4.7）

`tools`：

| 字段 | 类型 | 约束 / 索引 |
| --- | --- | --- |
| id | BIGINT | 主键自增 |
| organization_id | BIGINT | FK organizations.id，NOT NULL，索引 |
| name | VARCHAR(100) | NOT NULL；UniqueConstraint(organization_id, name) |
| description | TEXT | 可空 |
| type | VARCHAR(20) | NOT NULL；`calculator` / `http`（D01） |
| schema | JSON | NOT NULL；input JSON Schema（D06） |
| config | JSON | 可空；执行器固定配置（D06） |
| status | VARCHAR(20) | server_default `"active"` |
| created_by | BIGINT | FK users.id，可空（D07） |
| created_at / updated_at | DATETIME | server_default now() |

`agent_tools`：

| 字段 | 类型 | 约束 / 索引 |
| --- | --- | --- |
| id | BIGINT | 主键自增 |
| agent_id | BIGINT | FK agents.id，NOT NULL，`ON DELETE CASCADE`，索引 |
| tool_id | BIGINT | FK tools.id，NOT NULL，`ON DELETE CASCADE`，索引 |
| enabled | BOOLEAN | server_default true |
| config_json | JSON | 可空；非 null 覆盖 tools.config（D08） |
| created_at | DATETIME | server_default now() |

UniqueConstraint(agent_id, tool_id, name="uq_agent_tool")（D03）。

### 2.3 接口设计

依赖注入沿用 knowledge 模块：`OrgCtx`（owner/admin/member/viewer）、`AdminCtx`（owner/admin），均经 `require_header_org_role`（`app/api/deps.py`）；组织头缺失 / 非数字 403，跨组织 404。

工具管理（顶层 `/tools`）：

- `GET /tools` → list[ToolDetail]（全员）
- `POST /tools` → 201 ToolDetail（AdminCtx）——校验 name 非空 / 组织内唯一、type 合法、schema 为合法 JSON Schema、config 依类型校验
- `GET /tools/{tool_id}` → ToolDetail（全员；跨组织 404 TOOL_NOT_FOUND）
- `PATCH /tools/{tool_id}` → ToolDetail（AdminCtx）
- `DELETE /tools/{tool_id}` → 204（AdminCtx；绑定随 FK CASCADE）
- `POST /tools/{tool_id}/test` → ToolTestResponse（AdminCtx；body `{arguments: dict}`，执行一次并返回 `{status, output, error, duration_ms}`）

Agent 绑定（挂在 `/agents/{agent_id}/tools`，agent 归属校验复用 AgentService 语义 → 404）：

- `GET /agents/{agent_id}/tools` → list[AgentToolDetail]（含 tool 名 / type / enabled / config_json）
- `POST /agents/{agent_id}/tools` → 201（AdminCtx；body `{tool_id, enabled?, config_json?}`；重复绑定 409 AGENT_TOOL_ALREADY_BOUND）
- `PATCH /agents/{agent_id}/tools/{tool_id}` → AgentToolDetail（AdminCtx；改 enabled / config_json）
- `DELETE /agents/{agent_id}/tools/{tool_id}` → 204（AdminCtx）

实现位置：绑定端点与 `/tools` 端点同文件 `api/v1/tools.py`（router 顶层挂载，路径含 `/agents/...` 不影响组织隔离依赖）。

错误码（追加 `core/exceptions.py`）：

| 错误码 | 状态码 | 场景 |
| --- | --- | --- |
| TOOL_NOT_FOUND | 404 | 工具不存在 / 跨组织 |
| TOOL_NAME_CONFLICT | 409 | 工具名组织内重复 |
| TOOL_TYPE_INVALID | 422 | type 非 calculator/http |
| TOOL_SCHEMA_INVALID | 422 | schema 非法 JSON Schema |
| TOOL_CONFIG_INVALID | 422 | config 与 type 不匹配（http 缺 url 等） |
| TOOL_SSRF_BLOCKED | 422 | HTTP 工具目标为内网 / 非法地址 |
| TOOL_RUN_ERROR | 502 | 工具执行失败 |
| AGENT_TOOL_ALREADY_BOUND | 409 | 重复绑定 |
| AGENT_TOOL_NOT_FOUND | 404 | 绑定不存在 |

### 2.4 工具执行器（integrations/tool_runners.py）

```python
# ToolResult：执行结果统一结构（ok/error 不抛异常，D11）
# ToolRunner Protocol: async def run(config: dict|None, arguments: dict) -> ToolResult
# TOOL_RUNNERS 注册表：{"calculator": CalculatorRunner(), "http": HttpRunner()}
# get_runner(tool_type) -> ToolRunner
# to_openai_tool(tool) -> {"type":"function","function":{"name","description","parameters":tool.schema}}
# run_tool(tool, arguments) -> ToolResult：捕获一切异常 → error ToolResult
```

- **CalculatorRunner**：`ast.parse(expr, mode="eval")` + 白名单遍历（Expression / BinOp / UnaryOp / Constant / Call；运算符 `+ - * / // % **`；函数仅 abs / round / min / max；禁 Attribute / Name 及白名单外节点）；`eval(compiled, {"__builtins__": {}}, SAFE_FUNCS)`；结果非 int/float、除零、溢出 → error ToolResult。schema 固定为 `{"type":"object","properties":{"expression":{"type":"string"}},"required":["expression"]}`，config=null。
- **HttpRunner**：config 提供 `url`（支持 `{key}` 占位符以 arguments 注入）/ `method`（默认 GET）/ `headers` / `body`；SSRF 基础防护（D13 见风险）：scheme 仅 http/https；host IP 判私有 / 回环 / 链路本地 / 保留段即拒；DNS 解析结果再校验；`follow_redirects=False`（3xx 直接报错）；`httpx.Timeout(connect=5.0, read=15.0)`；响应文本截断 8000 字符；status >= 400 → error ToolResult。
- **输入参数来源**（D06）：`schema` 定义 LLM 产出的 arguments 形状；`config` 定义固定执行目标；HttpRunner 内以 `{key}` 占位符桥接两者。
- Search / Weather 不写专用执行器：前端模板预填 HTTP config（见 3.3）。

### 2.5 LLM 客户端扩展（integrations/llm.py，向后兼容）

`chat_stream(*, messages, model, temperature, max_tokens, tools: list[dict] | None = None)`：

- `tools` 非空时 payload 追加 `"tools": tools, "tool_choice": "auto"`；messages 类型放宽为 `list[dict]`（历史含 tool 角色消息）。
- 流式 tool_calls 解析：上游 delta 中 `choices[0].delta.tool_calls` 为 `[{index, id, function: {name, arguments}}]`，arguments 为字符串片段；用 `dict[int, {id, name, args_parts}]` 累加器按 index 拼接，流结束时 `json.loads` 解析 arguments（失败记 error 占位，D11 由上层降级）。
- 产出协议新增键（旧调用方忽略未知键，不被破坏）：
  - `{"delta": str}` 内容片段（原有）
  - `{"tool_calls": [{"id", "name", "arguments"}]}` 每轮结束若有（新增）
  - `{"usage": {...} | None}` 恒为最后帧（原有）
- 保持「纯基础设施、不依赖 FastAPI」边界（chat.md 2.5），测试以 monkeypatch 替换 `chat_stream`。

### 2.6 对话编排 Tool Calling 循环（services/chat_service.py）

抽取共享生成器 `_agent_loop(ctx, tools)` 产出内部事件 `(event_name, payload)` 元组；`sse_events` 映射为 SSE 帧，`send_message`（同步路径）消费为最终文本——两条路径共用一套循环逻辑：

```python
# _agent_loop(ctx, tools)：需求 5.1 第 6 步落地；D09 上限 5 轮；D10 中间轮不落库
for rnd in range(1, 6):
    async for item in chat_stream(messages=llm_message, tools=tools | None, ...):
        "delta" → 累积文本；"tool_calls" → calls；usage → _merge_usage 逐轮求和（None 跳过）
    if not calls:                       # LLM 产出终答
        yield done(content, trace, usage, max_rounds=False)；return
    llm_message.append({"role": "assistant", "content": 文本或 None, "tool_calls": calls})
    for c in calls:
        yield ("tool_call", {round, name, arguments})                  # 前端展示「调用中」
        res = run_tool(name_map[c["name"]], c["arguments"])            # error 不外抛（D11）
        trace.append({round, name, arguments, status, output, error})
        yield ("tool_result", {round, name, status, output})
        llm_message.append({"role": "tool", "tool_call_id": c["id"],
                            "content": res.output or res.error or ""})
# 超限：以当前部分文本终结，trace 标记 max_rounds_reached
yield done(content="（已达工具调用轮次上限）", trace, usage, max_rounds=True)
```

改动点：

- `_build_context` 增一步：查 `agent_tools JOIN tools WHERE agent_id=... AND enabled=true` → 组装 `tools=[to_openai_tool(t)]` 与 `name_map: dict[name, Tool]`；无绑定传 None（零改动走原路径）。
- `_persist_assistant` 的 `metadata_json` 增 `"tool_calls": trace`（与 rag / sources 并列，历史刷新可恢复工具轨迹展示）。
- token_usage 多轮汇总：多数 provider 仅最终轮带 usage，`_merge_usage` 对 None 跳过、存在项逐字段求和，可能仅反映末轮（记录即可，不阻塞）。
- 命名冲突防御：同一轮内 `name_map` 查不到调用名（schema 未绑定）→ 该调用按 error 结果回传，不中断循环。

### 2.7 SSE 事件协议（对齐 chat.md 2.4，新增 tool 事件）

```
event: message         data: {"delta": "我来"}
event: tool_call       data: {"round": 1, "name": "calculator", "arguments": {"expression": "1+1"}}
event: tool_result     data: {"round": 1, "name": "calculator", "status": "ok", "output": "2"}
event: done            data: {"message_id": 12, "token_usage": {...}, "sources": [...], "tool_calls": [ToolCallRun...]}
```

- `ToolCallRun = {"round", "name", "arguments", "status"("ok"|"error"), "output", "error"}`。
- `SseDonePayload` 增可选 `tool_calls: list[ToolCallRun]`（无工具调用时不发 / 空列表）。
- 流中失败仍走 `error` 事件（协议不变）。

### 2.8 组织解散联动

`organization_service.dissolve()` 销毁顺序插入工具清理：agents → knowledge bases → **tools（`ToolService.delete_by_org`）** → members → organization（agent_tools 已随 agents CASCADE 清理；tools 由 service 显式删）。

## 3. 前端实现

### 3.1 目录结构

```
frontend/src/
├─ api/tools.ts                    # 全部端点封装（X-Organization-Id 由 http.ts 自动带）
├─ api/index.ts                    # 追加导出 toolApi
├─ types/tool.ts                   # ToolType/ToolDetail/ToolTestResponse/AgentToolDetail/ToolCallRun
├─ types/chat.ts                   # SseDonePayload 增 tool_calls
├─ types/index.ts                  # 追加导出
├─ hooks/useTools.ts               # 工具列表 / 详情 / 变更（React Query）
├─ hooks/useAgentTools.ts          # 绑定列表 / 绑定 / 解绑 / 开关
├─ pages/tools/List.tsx            # 工具卡片网格（照抄 pages/knowledge/List.tsx 模式）
├─ pages/tools/Form.tsx            # 新建 / 编辑（type 二选一 + HTTP 模板）
├─ pages/tools/Detail.tsx          # schema/config 展示 + 测试运行表单
├─ pages/agents/Detail.tsx         # 增「工具」inline 区块（绑定管理）
├─ constants/tool-templates.ts     # Search / Weather HTTP 模板（预填 config）
├─ constants/routes.ts             # 追加 TOOLS 路由常量与生成函数
├─ components/layout/AppLayout.tsx # 侧边栏增「工具」菜单
├─ utils/sse.ts                    # SseHandlers 增 onToolCall / onToolResult
├─ hooks/useChatStream.ts          # 工具事件状态 + 消息流工具 chip 数据
├─ pages/chat/Chat.tsx             # 渲染「工具调用」chip（spinner → 结果）
└─ components/chat/MessageBubble.tsx  # toolCalls prop 渲染历史轨迹折叠区
```

### 3.2 路由与入口

- `/organizations/:orgId/tools`（TOOLS）、`/tools/new`（TOOL_NEW）、`/tools/:toolId`（TOOL_DETAIL）、`/tools/:toolId/edit`（TOOL_EDIT）；NEW 声明在 `:toolId` 之前（同 knowledge 的坑）。
- 侧边栏「工具」菜单（agentsPath 同款组织内禁用逻辑）。
- 权限控制：`agent-options.ts` 同款新增 canManageTool 判断（前端隐藏写入口，后端为准）。

### 3.3 工具管理页

- **List.tsx**：标题 + 新建按钮 + 卡片网格（名称 / 类型徽标 / 描述 / 状态），错误提示与加载态对齐 knowledge List。
- **Form.tsx**：type 二选一；
  - 选 http：出现「模板」按钮（Search / Weather），点击预填 config（`constants/tool-templates.ts`）+ 描述 + schema 建议；也可手填 url/method/headers/body 与 schema；
  - 选 calculator：schema 固定 expression 表单（只读展示）；
  - schema 编辑提供 JSON 文本域（校验通过后提交）。
- **Detail.tsx**：概览（name/type/description）+ schema / config 只读展示 + 「测试运行」表单（输入 arguments JSON → 调 test 接口 → 展示 status/output/error/duration_ms）+ 编辑 / 删除按钮。

### 3.4 Agent 绑定 UI（pages/agents/Detail.tsx）

「工具」inline 区块：

- 已绑定列表：工具名 + type + enabled 开关（PATCH）+ 解绑按钮（二次确认）
- 「绑定工具」弹层：工具列表选择 + 可选 config_json 覆盖输入（D08）

### 3.5 对话渲染

- `utils/sse.ts`：解析分支增 `tool_call` / `tool_result` 事件，SseHandlers 增 `onToolCall(payload)` / `onToolResult(payload)`。
- `useChatStream.ts`：状态机增工具事件状态（当前进行中的 tool_call 列表），`send` 前清空、`done` 后沉淀到消息。
- `Chat.tsx` 消息流：助手消息内渲染工具 chip——`tool_call` 事件插入「调用 {name}({arguments})…」spinner chip，`tool_result` 事件转变为结果摘要（成功绿色 / 失败红色，可点开看 output）。
- `MessageBubble.tsx`：增 `toolCalls?: ToolCallRun[]` prop，从 `metadata_json.tool_calls` 渲染历史轨迹折叠区（类比 sources 引用卡片）。

## 4. 数据库迁移

`20260922_0006_create_tool_tables.py`：建 `tools`、`agent_tools` 两表（字段与 2.2 一致，含 `uq_tool_name` / `uq_agent_tool` 唯一约束与索引）。执行方式沿用项目惯例：重建容器 + `alembic upgrade head`（后端目录内，DATABASE_URL 指向 13306）。

## 5. 测试与验收

后端 `tests/test_tools.py`（体例对齐 `test_agent.py` / `test_knowledge.py`）：

- 工具 CRUD 全流程；跨组织隔离（非成员 403、跨组织 404）；名称冲突 409；type / schema / config 校验 422
- 测试接口：calculator 正常 / 非法表达式（error 不抛）；http mock 成功 / 失败；内网 URL 触发 TOOL_SSRF_BLOCKED
- 绑定：绑定 / 解绑 / 重复绑定 409 / enabled 开关生效 / 权限矩阵（member/viewer 写 403）
- 解散联动：dissolve 后 tools 与绑定清理

`tests/test_chat.py` 追加 tool calling 用例（monkeypatch `get_llm_client().chat_stream` 假流：首轮带 tool_calls、末轮纯文本）：

- SSE 输出含 `tool_call` / `tool_result` 事件序列与 `done.tool_calls`
- `metadata_json.tool_calls` 轨迹落库、token_usage 汇总正确
- 超 5 轮强制终结（max_rounds_reached）；工具执行失败降级为 tool 结果回传、对话继续

验收标准（对齐需求第 8 节第 7 条）：

1. 组织内 owner/admin 可创建 / 测试 / 编辑 / 删除工具并绑定到 Agent，viewer 只读
2. calculator 与 http 工具经测试接口可独立验证可用性
3. 绑定工具的 Agent 在对话中触发工具调用：助手消息展示工具调用过程（chip），流式不中断
4. 刷新历史后工具轨迹可回溯（track 卡片）；工具失败不中断对话
5. 跨组织工具不可见、不可绑定，组织解散后工具清理

## 6. 实施步骤

1. 迁移 0006 + `models/tool.py` + `models/__init__.py` 导出 → `alembic upgrade head`
2. `schemas/tool.py` + `core/exceptions.py` 错误码
3. `repositories/tool_repo.py` + `services/tool_service.py`（CRUD / 隔离 / 测试 / 绑定 / delete_by_org）+ `organization_service.dissolve` 接入
4. `api/v1/tools.py`（含绑定端点）+ `api/v1/router.py` 挂载
5. `integrations/tool_runners.py`（calculator / http + SSRF 防护）+ 执行器单测
6. `integrations/llm.py` 扩展 tools / tool_calls 累加器 + 单测
7. `services/chat_service.py` `_agent_loop` 重构 + `schemas/chat.py`（SseDonePayload.tool_calls / ToolCallRun）+ `_build_context` 绑定加载
8. 后端测试 `test_tools.py` + `test_chat.py` 工具用例全绿
9. 前端 `types/api/hooks` + 路由 / 菜单 + tools 三页 + 模板常量
10. Agent 详情绑定 UI + 对话 chip / 轨迹渲染（sse.ts / useChatStream / Chat / MessageBubble）
11. 联调：Docker 重建 + 迁移 → 建 calculator 工具 → 绑定 Agent → 对话「1+1 等于几」验证工具调用全链路（SSE 帧 / chip / 历史轨迹 / done.tool_calls）

## 7. 风险与对策

- **死循环**：D09 max_rounds=5 硬限兜底；LLM 不返回 tool_calls 时沿用 chat.md D13 空输出处理
- **SSRF**：V1 做 scheme 白名单 + 逐跳 host IP 校验 + 禁重定向（DNS rebinding、IPv6、编码 IP 等残余风险注明，后续可升级代理或域名白名单）
- **模型兼容**：部分模型不支持 tools 参数；tools=None 时调用链零改动，模型返回兼容性错误由上游错误路径兜底
- **arguments 非法 JSON**：json.loads 捕获后作为 tool error 回传，提示模型重试
- **usage 缺失**：中间轮无 usage，汇总值可能偏低，仅记录不阻塞主流程