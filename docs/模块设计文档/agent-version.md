# Agent Version 版本管理模块设计文档

> 本文档描述 Agent Version 版本管理模块的**当前实际实现**，以代码为准，供后期维护与迭代参考。体例沿用《Auth 模块设计文档》（`docs/模块设计文档/auth.md`）、《Organization 组织管理模块设计文档》（`docs/模块设计文档/organization.md`）与《Agent 智能体管理模块设计文档》（`docs/模块设计文档/agent.md`）。
> 需求依据：`docs/需求文档 V1.0.md` 第 3.4（版本管理）、第 4.5（`agent_versions` 表）、第 4.4（`agents.current_version_id`）及第 7 节 V1 开发范围、第 8 节验收标准第 9 条。所有文件引用均为仓库根目录相对路径。
>
> **文档边界**：智能体 CRUD、组织隔离基础设施（`X-Organization-Id`、`require_header_org_role`）与权限矩阵主干见 `docs/模块设计文档/agent.md`，本文档只在交集处简要引用；本文档聚焦版本子模块（数据模型、迁移、版本四接口、并发控制、前端版本交互）的完整细节。

## 1. 模块概述

功能清单（对应需求 3.4）：

- 版本列表：按 `version` 倒序返回全部版本，响应含计算字段 `is_current`
- 创建版本：将提交的配置快照为新版本，**仅创建不发布**
- 发布版本：将目标版本设为当前版本（`agents.current_version_id`）
- 回滚版本：将当前版本指回目标历史版本，**不产生新版本**
- 初始版本：创建智能体时自动生成 v1 并发布（交集，主体流程见 `docs/模块设计文档/agent.md`）

产品决策（基线，改动需同步本文档）：

| # | 决策 | 说明 |
| --- | --- | --- |
| V1 | 运行配置的唯一版本化来源是 `agent_versions` | `agents` 表不存配置字段，仅存基础信息 + `current_version_id`（需求 4.4/4.5） |
| V2 | 创建版本 ≠ 发布版本 | 两个独立动作：`POST .../versions` 仅落快照，发布走独立端点（需求 3.4 三功能拆分） |
| V3 | 回滚 = 切换指针，不产生新版本 | `rollback` 与 `publish` 共用 `_set_current`，只更新 `agents.current_version_id` |
| V4 | 版本序号 agent 内从 1 递增 | `version = MAX(version) + 1`；`uq_agent_version_seq(agent_id, version)` 兜底 |
| V5 | `is_current` 为计算字段，不落库 | 由 `agents.current_version_id` 推导，避免"双 true"不一致 |
| V6 | 并发安全双保险 | agent 行 `FOR UPDATE` 串行化 + 唯一约束兜底 + 冲突重试（最多 3 次） |
| V7 | 权限沿用组织角色矩阵 | owner/admin 可管理，member/viewer 只读（与 `docs/模块设计文档/agent.md` D8 一致） |

前后端对应关系：

| 功能 | 后端接口（需求 3.4） | 前端实现 |
| --- | --- | --- |
| 版本列表 | `GET /api/v1/agents/{agent_id}/versions` | `hooks/useAgent.ts` 的 `useAgentVersions` → `pages/agents/Detail.tsx` 版本历史区 |
| 创建版本 | `POST /api/v1/agents/{agent_id}/versions` | `pages/agents/VersionForm.tsx` |
| 发布 | `POST /api/v1/agents/{agent_id}/versions/{version_id}/publish` | `pages/agents/Detail.tsx`「发布」按钮 |
| 回滚 | `POST /api/v1/agents/{agent_id}/versions/{version_id}/rollback` | `pages/agents/Detail.tsx`「回滚」按钮（二次确认） |

## 2. 后端实现

### 2.1 目录结构与分层

本模块涉及文件：

```
backend/
├─ alembic/versions/20260920_0003_agent_versioning.py   # 建 agent_versions + 重构 agents + 存量回填
├─ app/
│  ├─ api/deps.py                    # require_header_org_role（交集，agent.md 2.3）
│  ├─ api/v1/agents.py               # 版本四端点（顶层 prefix=/agents）
│  ├─ api/v1/router.py               # 挂载 agents.router（交集）
│  ├─ core/exceptions.py             # AgentVersionNotFound / AgentVersionConflict
│  ├─ models/agent_version.py        # AgentVersion（需求 4.5）
│  ├─ models/agent.py                # Agent.current_version_id（需求 4.4，交集）
│  ├─ schemas/agent.py               # AgentVersionCreateRequest / AgentVersionItem
│  ├─ repositories/agent_repo.py     # 版本数据访问 + get_by_id_for_update（行锁）
│  ├─ services/agent_service.py      # list_versions / create_version / publish_version / rollback_version（create_agent 生成 v1 属交集）
│  └─ tests/test_agent.py            # 版本相关集成用例
```

分层链路与 auth / organization / agent 模块一致：`router → AgentService → AgentRepository → SQLAlchemy`。权限复用 `require_header_org_role` 组织作用域别名，service 层只补智能体与版本的归属校验。

### 2.2 数据模型

`agent_versions`（对齐需求 4.5，模型见 `backend/app/models/agent_version.py`）：

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| `id` | BigInteger | PK, autoincrement | — |
| `agent_id` | BigInteger | FK→`agents.id`, not null, `ondelete=CASCADE` | agent 删除时版本级联清理；索引 `ix_agent_versions_agent_id` |
| `version` | Integer | not null | 序号从 1 递增；`uq_agent_version_seq(agent_id, version)` 唯一 |
| `system_prompt` | TEXT | not null | 需求 4.5；无 DB 默认值（MySQL TEXT 不支持字面量 server_default），非空由 schema 默认 `""` 保证 |
| `model_provider` | VARCHAR(50) | not null | 自由文本，仅长度校验 |
| `model_name` | VARCHAR(100) | not null | 同上 |
| `temperature` | FLOAT | nullable | null = 运行时默认 |
| `max_tokens` | Integer | nullable | null = 运行时默认 |
| `config_json` | JSON | nullable | 扩展参数字典 |
| `created_by` | BigInteger | FK→`users.id`, not null | 仅记录，不参与权限 |
| `created_at` | DateTime | server_default `CURRENT_TIMESTAMP` | — |

- **环回外键**：`agents.current_version_id → agent_versions.id` 与 `agent_versions.agent_id → agents.id` 互指；前者在模型中用 `use_alter=True` 延迟建约束（`fk_agents_current_version`，`ondelete=SET NULL`）。两模型**均不建 relationship**，加载一律显式查询，避免懒加载冲突与 `MissingGreenlet`。

### 2.3 数据库迁移

`backend/alembic/versions/20260920_0003_agent_versioning.py`（head 即此版本）：

1. 建 `agent_versions` 表（含 `uq_agent_version_seq` 唯一约束与 `ix_agent_versions_agent_id` 索引）
2. `agents` 表重构：`description` 改 TEXT、补 `avatar_url` 与 `current_version_id`、建环回外键
3. **存量数据回填**（单步内先建表后回填）：`INSERT INTO agent_versions ... SELECT ... FROM agents` 将存量智能体的 `system_prompt/provider/model/temperature/max_tokens` 快照为 v1，再 `UPDATE agents JOIN agent_versions SET current_version_id = v.id`
4. 删除 `agents` 上的五个配置列（`system_prompt` / `provider` / `model` / `temperature` / `max_tokens`）

回填必须在删列之前执行，否则存量配置丢失；新库无存量行时该步为空操作。

### 2.4 核心机制

- **单一配置来源（V1）**：运行配置只存在于 `agent_versions`；`AgentService._detail` / `_current_version` 显式按 `current_version_id` 查询当前版本并组装 `AgentDetail.current_version_detail`。
- **并发版本序号（V6）**：`create_version` 以 `FOR UPDATE` 行锁读取 agent（`AgentRepository.get_by_id_for_update`），串行化同一智能体的并发创建；插入撞 `uq_agent_version_seq` 时回滚并重试（最多 3 次），仍失败抛 `AgentVersionConflict`（409）。
- **发布/回滚事务骨架**：`_set_current` = 行锁读 agent → 校验 `version.agent_id == agent.id` → 赋值 `current_version_id` → commit → `db.refresh(agent)`（`updated_at` 带 onupdate，refresh 取回避免 `MissingGreenlet`）。
- **`is_current` 计算（V5）**：`list_versions` 对每条版本计算 `v.id == agent.current_version_id`；`_detail` 的当前版本恒为 `True`。不落库。
- **归属校验二道闸**：agent 层 `agent.organization_id == org.id`、版本层 `version.agent_id == agent.id`，不满足一律 404（不泄露跨组织存在性）。

### 2.5 接口明细

所有接口挂载于顶层 `/api/v1/agents`（`backend/app/api/v1/agents.py`），组织隔离经 `X-Organization-Id` 请求头，路径不含组织维度。

| 方法 | 路径 | 请求 | 成功响应 | 权限 | 错误码 |
| --- | --- | --- | --- | --- | --- |
| GET | `/agents/{agent_id}/versions` | — | 200 `AgentVersionItem[]`（version 倒序） | OrgCtx | `AGENT_NOT_FOUND` |
| POST | `/agents/{agent_id}/versions` | `AgentVersionCreateRequest` | 201 `AgentVersionItem` | AdminCtx | `AGENT_NOT_FOUND`、`AGENT_VERSION_CONFLICT` |
| POST | `/agents/{agent_id}/versions/{version_id}/publish` | — | 200 `AgentDetail` | AdminCtx | `AGENT_NOT_FOUND`、`AGENT_VERSION_NOT_FOUND` |
| POST | `/agents/{agent_id}/versions/{version_id}/rollback` | — | 200 `AgentDetail` | AdminCtx | 同上 |

`AgentVersionCreateRequest` 字段（与 `AgentCreateRequest` 的配置段一致）：

| 字段 | 约束 |
| --- | --- |
| `system_prompt` | 默认 `""`，≤10000 字符 |
| `model_provider` | 必填，1–50 字符 |
| `model_name` | 必填，1–100 字符 |
| `temperature` | 可选，0–2 |
| `max_tokens` | 可选，1–100000 |
| `config_json` | 可选字典 |

`AgentVersionItem` 响应字段：`id`、`version`、`system_prompt`、`model_provider`、`model_name`、`temperature`、`max_tokens`、`config_json`、`created_by_username`、`created_at`、`is_current`。

### 2.6 依赖注入与权限

- `require_header_org_role(*allowed_roles)`（`backend/app/api/deps.py`）是组织隔离唯一入口：头缺失/非数字 → 403 `FORBIDDEN`；组织不存在 → 404 `ORGANIZATION_NOT_FOUND`；非成员 → 403 `NOT_ORG_MEMBER`；角色不命中 → 403 `FORBIDDEN`；通过后返回 `(org, membership)`。
- `agents.py` 定义两个别名：`OrgCtx`（owner/admin/member/viewer）与 `AdminCtx`（owner/admin）。版本列表走 `OrgCtx`，创建/发布/回滚走 `AdminCtx`。
- 别名切到哪个角色集合、service 层不重复查 membership，详见 `docs/模块设计文档/agent.md` 2.3。

### 2.7 统一错误格式

`app/main.py` 为 `AppError` 注册全局异常处理器，响应体统一 `{code, message, detail}`，`message` 为中文文案、前端直接透传展示。非法参数的 Pydantic 校验错误则由 FastAPI 默认 422 处理（`detail` 为错误列表）。

### 2.8 相关配置项

版本模块自身**不读取任何专有配置**；运行依赖的配置均来自 `backend/app/core/config.py`（`backend/.env`）：

| 配置 | 默认 | 与模块的关系 |
| --- | --- | --- |
| `API_V1_PREFIX` | `/api/v1` | 路由挂载前缀 |
| `DATABASE_URL` / MYSQL 分项 | 分项默认 `mysql+asyncmy://root:@localhost:3306/agenthub` | 数据库连接；显式 `DATABASE_URL` 优先（迁移时以此覆盖目标库） |
| `JWT_SECRET_KEY` / `JWT_ALGORITHM` | `change-me-in-production` / HS256 | 鉴权链路（交集） |
| `CORS_ORIGINS` | `http://localhost:5173` | 浏览器跨域 |

### 2.9 测试体系

- 用例位置：`backend/tests/test_agent.py`（14 个集成用例，版本相关 3 个：`test_version_publish_rollback`、`test_version_not_found_and_cross_agent`、`test_dissolve_cascades_agents_and_versions`；另有 `test_viewer_readonly` 覆盖版本管理操作 403 与 `test_delete_agent` 覆盖版本级联清空）。`is_current` 断言内嵌于 `test_create_agent_with_v1` 与 `test_version_publish_rollback`。
- 全量回归：`pytest`（当前 53 passed = agent 14 + organization 23 + auth 10 + security 6；security 为类内方法不依赖数据库）。
- **conftest 特殊配置及其成因**（`backend/tests/conftest.py`、`backend/pytest.ini`）：
  - 测试库默认 `mysql+asyncmy://root:123456@localhost:3306/agenthub_test`，可用 `TEST_DATABASE_URL` 覆盖；session 级 fixture 先 `CREATE DATABASE IF NOT EXISTS` 再 `alembic upgrade head`（每次全量跑迁移，天然验证迁移可重放）。
  - `pytest.ini` 将 asyncio 的 fixture/test 循环作用域统一为 `session`，且测试引擎用 `NullPool`——成因：asyncmy 连接跨事件循环复用会损坏 greenlet，此前在函数级循环 + 会话级 fixture 组合下必现。
  - 每个用例结束按外键顺序清空业务数据：版本 → 智能体 → 成员 → 组织 → 用户。
  - 用例通过 ASGITransport 走真实 `app`，`get_db` 被 override 为测试库会话。

## 3. 前端实现

### 3.1 目录结构与依赖方向

```
frontend/src/
├─ api/agents.ts                     # agentApi 四个版本方法
├─ types/agent.ts                    # AgentVersionCreateRequest / AgentVersionItem（含 is_current）
├─ constants/routes.ts               # AGENT_VERSION_NEW 与 agentVersionNewPath()
├─ constants/agent-options.ts        # canManageAgent（角色可见性，交集）
├─ hooks/useAgent.ts                 # useAgentVersions（queryKey ['org', orgId, 'agent', agentId, 'versions']）
├─ utils/http.ts                     # 请求拦截器：Authorization + X-Organization-Id
├─ pages/agents/VersionForm.tsx      # 新建版本表单
├─ pages/agents/Detail.tsx           # 版本历史区（发布/回滚）
└─ main.tsx / router/index.tsx       # orgIdProvider 装配 / 版本路由
```

依赖方向固定：`pages → hooks / stores / api / components → utils / constants / types`，不可反向。`utils/http.ts` 不反向依赖 stores——组织 id 经 `setOrgIdProvider` 回调注入。

### 3.2 状态与持久化单点

- Token：`utils/token.ts` 是 localStorage 唯一读写入口（`agenthub.access_token` / `agenthub.refresh_token`），拦截器、守卫、store 均经它访问。
- 组织上下文：`stores/organization.ts` 用 zustand `persist` 存 `currentOrgId`（key `agenthub.current_org_id`）；`main.tsx` 注册的 `orgIdProvider` 以 URL `/organizations/:orgId/*` 为优先、zustand 为回落，`utils/http.ts` 请求拦截器据此自动写入 `X-Organization-Id` 头。
- 服务端数据统一托管 React Query（`utils/query-client.ts`：`staleTime` 30s、`retry` 1、不随窗口聚焦刷新）；版本列表 queryKey = `['org', orgId, 'agent', agentId, 'versions']`，orgId 仅参与缓存隔离，实际隔离靠请求头。
- 缓存联动：创建版本 → 失效版本 key + 详情 key；发布/回滚 → 失效版本 key + 详情 key + 列表前缀 `['org', orgId, 'agents']`。

### 3.3 核心逻辑

- **请求拦截器**（`utils/http.ts`）：自动携带 `Authorization: Bearer <access>` 与 `X-Organization-Id`；401 时单飞刷新（并发 401 共用同一 refresh Promise）、刷新成功以 `_retried` 标记重放原请求、失败则清 Token 并触发全局登出回调；`/auth/login|register|refresh` 白名单不触发无感刷新（防死循环）。
- **路由守卫**：`router/RequireAuth.tsx` 按 `stores/auth.ts` 布尔态未登录跳登录页并记录来源路径，登录后回跳。
- **版本交互语义映射**（`Detail.tsx`）：当前版本徽章以响应 `is_current` 为准（兜底比对 `current_version_detail.id`）；非当前版本中，`version` 小于当前序号 →「回滚」按钮，大于当前序号（即未发布的新版本）→「发布」按钮。
- 回滚二次确认用 `window.confirm`，确认文案含目标版本号；发布无二次确认直接调用。

### 3.4 页面交互与校验规则

**VersionForm.tsx（新建版本）**

- 基于当前版本**预填**全部配置字段（Provider / 模型 / Temperature / Max Tokens / 系统提示词），便于微调。
- 表单由 react-hook-form + zod 校验，规则与后端 `AgentVersionCreateRequest` 一一对应（见 2.5 字段约束表）；`temperature` / `max_tokens` 以字符串承载表单值，空串 = `null`（运行时默认），提交时转换。
- 提交只调用 `POST .../versions`（仅创建），成功后回详情页手动发布——与 V2 决策一致。

**Detail.tsx（版本历史区）**

- 列表行：版本号、`provider / model`、创建者与时间、当前版本徽章或「发布/回滚」按钮（仅 owner/admin 渲染操作）。
- 页面顶部「新建版本」按钮跳 `AGENT_VERSION_NEW`；member/viewer 无任何写操作入口（`canManageAgent` 收敛，后端为准）。

### 3.5 工程配置

- 构建：`npm run build` = `tsc -b && vite build`（类型检查并入构建，类型与后端 schema 不一致会直接构建失败）。
- 交付：多阶段 Dockerfile（node:22-alpine 构建 → nginx:1.27-alpine 托管）；`frontend/nginx.conf` 将 `/api/` 反代到 `backend:8000`，`try_files` 回退 `index.html` 支持 SPA 路由（版本新页直达刷新不 404）。
- 开发：`npm run dev`（Vite）。

## 4. 关键流程时序

**4.1 创建版本（含并发控制）**

1. Detail「新建版本」→ VersionForm 基于当前版本预填 → zod 校验 → `POST /agents/{id}/versions`（头带 `X-Organization-Id`）
2. 后端 `AdminCtx` → `create_version`：`FOR UPDATE` 锁 agent 行 → `version = MAX(version)+1` → INSERT 快照 → commit（撞唯一约束则回滚重试，3 次后抛 409）
3. 前端失效版本/详情缓存 → 回详情页（新版本出现在版本历史，标记「发布」）

**4.2 发布版本**

1. Detail 版本历史点「发布」→ `POST .../versions/{vid}/publish`
2. 后端 `_set_current`：行锁读 agent → 校验 `version.agent_id == agent.id` → `current_version_id = vid` → commit → `db.refresh(agent)`
3. 前端失效版本/详情/列表缓存 → 详情页当前版本与各版本 `is_current` 联动刷新

**4.3 回滚版本**

1. Detail 版本历史点「回滚」→ `window.confirm` 确认 → `POST .../versions/{vid}/rollback`
2. 后端与发布完全同路径（`_set_current`），不产生新版本记录
3. 前端同发布刷新联动；回滚后序号更大的版本在列表中转为「发布」按钮

**4.4 版本列表与 is_current**

1. Detail 挂载 → `useAgentVersions` → `GET /agents/{id}/versions`
2. 后端 `list_versions`：归属校验 → 查版本（version 倒序）→ 批量映射创建者用户名 → 计算 `is_current = (v.id == current_version_id)`
3. 前端渲染徽章与 发布/回滚 按钮（语义映射见 3.3）

**4.5 创建智能体初始 v1（交集，详见 agent.md 4.1）**

1. `POST /agents` → 事务：建 agent → 建 v1（version=1）→ 指向 `current_version_id` → 显式 flush → refresh → commit

## 5. 错误码对照表

| 后端 code | HTTP 状态 | 触发场景 | 前端文案 |
| --- | --- | --- | --- |
| `AGENT_VERSION_NOT_FOUND` | 404 | 版本不存在，或不属于该 agent（发布/回滚路径） | 透传后端 message「智能体版本不存在」 |
| `AGENT_VERSION_CONFLICT` | 409 | 并发生成同序号版本，重试 3 次仍撞唯一约束 | 透传后端 message「版本创建冲突，请重试」 |
| `AGENT_NOT_FOUND` | 404 | 版本接口的 agent 不存在或不属于当前组织 | 透传后端 message「智能体不存在」 |
| `FORBIDDEN` | 403 | 头缺失/非数字；member/viewer 调用写接口（AdminCtx 不命中） | 透传后端 message「没有操作权限」 |
| `NOT_ORG_MEMBER` | 403 | 当前用户不是请求头组织成员 | 透传后端 message「您不是该组织成员」 |
| `ORGANIZATION_NOT_FOUND` | 404 | 请求头组织不存在 | 透传后端 message「组织不存在」 |
| （Pydantic 422） | 422 | system_prompt 超长、temperature 越界、max_tokens 越界、model_provider/model_name 缺省或超长 | 前端 zod 先行拦截；漏网时透传后端 message |
| （非业务错误） | — | 网络中断、超时等 axios 错误 | `errorMessage()` 兜底「网络异常，请稍后重试」；非 ApiError 非 Error 兜底「操作失败，请稍后重试」 |

- 响应体格式统一 `{code, message, detail}`（`backend/app/main.py` 全局异常处理器）；前端 `errorMessage()`（`frontend/src/constants/error-messages.ts`）对 `ApiError` 直接透传后端中文 `message`。
- 注：`AGENT_NAME_CONFLICT` / `AGENT_FIELD_REQUIRED` 属智能体 CRUD 域，见 `docs/模块设计文档/agent.md` 第 5 节。

## 6. 维护约定与约束

1. **版本是运行配置唯一来源（V1）**：任何"改模型/改 Prompt"需求都必须走「新建版本 → 发布/回滚」，禁止给 `agents` 表或 PATCH 接口加配置字段。
2. **并发控制双保险不可退化（V6）**：`create_version` 的行锁读取 + 最多 3 次重试是刻意设计；裸 `MAX+1` 会在并发下产生同序号版本。发布/回滚同样必须行锁（防「读到 Version 后被其他请求改 Agent」的竞态）。
3. **回滚语义已固定（V3）**：回滚 = 切换指针、不产生新版本；若将来要"回滚出新版本"（v4 = v1 副本），属另一种版本模型，需改文档与前端交互，不得静默变更。
4. **`is_current` 不落库（V5）**：给 `agent_versions` 加 `is_current` 列会引入"多个 true"的一致性问题；保持查询时计算。
5. **环形外键不建 relationship**：`current_version_id ↔ agent_id` 互指，加载一律显式查询，避免懒加载冲突与 `MissingGreenlet`。
6. **归属校验二道闸**：版本操作必须先校验 agent 归属（404）再校验 version 归属（404），不能只查 `agent_id` 或只查版本，否则跨组织/跨 agent 可越权操作。
7. **迁移不可回改**：`20260920_0003` 已含存量回填并已执行到 head（Docker 内 13306 库）；任何表结构变更必须新增迁移。`alembic` 执行须在 backend 目录、以 `DATABASE_URL` 指向目标库。
8. **前端语义映射依赖 V3**：详情页「发布/回滚」按钮基于 `version` 序号与当前序号的比较推导；回滚语义变更后此映射必须同步调整。
9. **测试循环作用域不要改**：`pytest.ini` 的 session 级循环与 `NullPool` 是为规避 asyncmy 跨事件循环损坏而设；新增用例沿用 conftest 模式与清理链（版本 → 智能体 → 成员 → 组织 → 用户）。
10. **错误码 message 保持中文**：前端对业务错误直接透传后端 `message`，新增错误码时中文文案即用户可见文案。