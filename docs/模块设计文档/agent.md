# Agent 智能体管理模块设计文档

> 本文档描述 Agent 智能体管理模块的**当前实际实现**，以代码为准，供后期维护与迭代参考。体例沿用《Auth 模块设计文档》（`docs/模块设计文档/auth.md`）与《Organization 组织管理模块设计文档》（`docs/模块设计文档/organization.md`）。
> 需求依据：`docs/需求文档 V1.0.md` 第 3.3（Agent 管理）、3.4（Agent Version）、4.4/4.5（数据表）及第 7 节 V1 开发范围。所有文件引用均为相对路径。

## 1. 模块概述

功能清单：

- 智能体：创建（含初始配置，自动生成 v1 并发布）、列表（名称模糊 + 状态过滤，展示名称/当前版本/状态/创建时间）、详情、编辑基础信息（名称/描述/头像）、启停、删除（版本级联删除）
- 版本：版本列表、创建版本（不自动发布）、发布版本、回滚版本（需求 3.4）

产品决策（基线，改动需同步本文档）：

| # | 决策 | 说明 |
| --- | --- | --- |
| D1 | 名称组织内唯一（1–100 字符），不做全局唯一 | `uq_agent_name(organization_id, name)` 保证；需求未约束，属实现细节 |
| D2 | 模型配置与提示词**版本化存储**（需求 4.5 agent_versions） | agents 表仅存基础信息 + `current_version_id`（需求 4.4）；创建即产生 v1 并发布 |
| D3 | 编辑语义拆分：PATCH 仅改基础信息；模型/Prompt 变更走「新建版本 → 发布」 | 对应需求 3.3「编辑支持修改描述/模型/Prompt」+ 3.4 版本化 |
| D4 | provider / model 为自由文本（仅长度校验），V1 不做 LLM 连通性测试 | 需求未枚举 provider；网关接入由聊天模块统一约束 |
| D5 | 启停即时生效、不删除配置：`status ∈ {enabled, disabled}` | 需求 3.3 创建字段含「状态」；创建可指定，默认 enabled |
| D6 | 删除为硬删除，版本随外键 `ON DELETE CASCADE` 级联清理 | 需求未定义级联；chat/日志模块落地后复审 |
| D7 | 列表 V1 全量 + `name` 模糊 + `status` 过滤，不分页 | 需求 3.3 列表仅定义展示字段，未要求分页 |
| D8 | 权限以组织角色为准：owner/admin 可管理，member/viewer 只读 | 对应需求 2.x 角色矩阵；member「使用对话」属聊天模块 |
| D9 | 组织隔离经请求头 `X-Organization-Id` | 需求 API 为顶层路径 `/api/v1/agents` 无组织维度；决策：路径按需求、隔离走请求头 |
| D10 | 组织解散须同事务先删该组织全部 agents（版本随 CASCADE） | 需确保 organization 模块 dissolve 的外键顺序 |

前后端对应关系：

| 功能 | 后端接口（需求 3.3/3.4） | 前端实现 |
| --- | --- | --- |
| 创建 | `POST /api/v1/agents` | `pages/agents/Form.tsx`（新建态） |
| 列表 | `GET /api/v1/agents` `?name=&status=` | `hooks/useAgents.ts` → `pages/agents/List.tsx` |
| 详情 | `GET /api/v1/agents/{agent_id}` | `hooks/useAgent.ts` → `pages/agents/Detail.tsx` |
| 编辑基础信息 | `PATCH /api/v1/agents/{agent_id}` | `pages/agents/Form.tsx`（编辑态） |
| 启停 | `PATCH /api/v1/agents/{agent_id}/status` | List 卡片开关 / Detail 页头按钮 |
| 删除 | `DELETE /api/v1/agents/{agent_id}` | `pages/agents/Detail.tsx`（危险区） |
| 版本列表 | `GET /api/v1/agents/{agent_id}/versions` | Detail 版本历史区 |
| 创建版本 | `POST /api/v1/agents/{agent_id}/versions` | `pages/agents/VersionForm.tsx` |
| 发布 | `POST /api/v1/agents/{agent_id}/versions/{version_id}/publish` | Detail 版本历史「发布」 |
| 回滚 | `POST /api/v1/agents/{agent_id}/versions/{version_id}/rollback` | Detail 版本历史「回滚」 |

权限矩阵（组织内，后端为准、前端按角色隐藏入口）：

| 操作 | owner | admin | member | viewer |
| --- | --- | --- | --- | --- |
| 查看列表 / 详情 / 版本 | ✔ | ✔ | ✔ | ✔ |
| 创建 / 编辑 / 启停 / 删除 | ✔ | ✔ | — | — |
| 创建版本 / 发布 / 回滚 | ✔ | ✔ | — | — |

## 2. 后端实现

### 2.1 目录结构与分层

本模块新增 / 修改的文件：

```
backend/
├─ alembic/versions/20260919_0002_create_agents_table.py   # 早前基线（已被 0003 重构）
├─ alembic/versions/20260920_0003_agent_versioning.py      # 重构 agents（对齐 4.4）+ 新建 agent_versions（4.5）
├─ app/
│  ├─ api/deps.py                  # 追加 require_header_org_role（X-Organization-Id 组织校验）
│  ├─ api/v1/agents.py             # 10 个端点（顶层 prefix=/agents）
│  ├─ api/v1/router.py             # 挂载 agents.router
│  ├─ core/exceptions.py           # 追加 AgentNotFound / AgentNameConflict / AgentFieldRequired / AgentVersionNotFound / AgentVersionConflict
│  ├─ models/agent.py              # Agent（对齐需求 4.4）
│  ├─ models/agent_version.py      # AgentVersion（对齐需求 4.5）
│  ├─ models/__init__.py           # 追加导出 Agent / AgentVersion
│  ├─ schemas/agent.py             # 请求/响应模型（CRUD + 版本）
│  ├─ repositories/agent_repo.py   # agents / agent_versions 数据访问
│  ├─ services/agent_service.py    # 业务逻辑与归属校验
│  ├─ services/organization_service.py  # dissolve 先删 agents（D10）
└─ tests/test_agent.py             # 14 个集成用例；conftest 清理链追加 AgentVersion
```

分层链路与 auth / organization 模块一致：`router → AgentService → AgentRepository → SQLAlchemy`。权限复用 `require_header_org_role` 的组织作用域别名，service 层只补智能体与版本的归属校验，不再重复查询成员关系。

### 2.2 数据模型

`agents`（对齐需求 4.4；迁移 `20260920_0003` 收口）：

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| `id` | BigInteger | PK, autoincrement | — |
| `organization_id` | BigInteger | FK→`organizations.id`, not null | 索引 `ix_agents_organization_id` |
| `name` | VARCHAR(100) | not null | 组织内唯一（D1） |
| `description` | TEXT | nullable | 需求 4.4 为 TEXT |
| `avatar_url` | VARCHAR(500) | nullable | 需求 4.4 头像 |
| `status` | VARCHAR(20) | not null, server_default `'enabled'` | `enabled` / `disabled` |
| `current_version_id` | BigInteger | FK→`agent_versions.id`, nullable, `ondelete=SET NULL` | 当前发布版本（需求 4.4） |
| `created_by` | BigInteger | FK→`users.id`, not null | 仅记录（D8） |
| `created_at` / `updated_at` | DateTime | server_default / onupdate 同现有表 | — |

`agent_versions`（对齐需求 4.5）：

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| `id` | BigInteger | PK, autoincrement | — |
| `agent_id` | BigInteger | FK→`agents.id`, not null, `ondelete=CASCADE` | agent 删除时版本级联清理（D6） |
| `version` | Integer | not null | 序号，从 1 起递增；`uq_agent_version_seq(agent_id, version)` |
| `system_prompt` | TEXT | not null | 需求 4.5 |
| `model_provider` | VARCHAR(50) | not null | 需求 4.5 |
| `model_name` | VARCHAR(100) | not null | 需求 4.5 |
| `temperature` | FLOAT | nullable | 需求 4.5；null = 运行时默认 |
| `max_tokens` | Integer | nullable | null = 运行时默认 |
| `config_json` | JSON | nullable | 扩展参数字典 |
| `created_by` | BigInteger | FK→`users.id`, not null | — |
| `created_at` | DateTime | server_default | — |

- **环形外键**：`agents.current_version_id → agent_versions.id` 与 `agent_versions.agent_id → agents.id` 互指，前者用 `use_alter=True` 延迟建约束后随迁移 `op.create_foreign_key` 落库；两模型**不建 relationship**（避免懒加载与加载冲突）
- **system_prompt 无 DB 默认值**：TEXT 列在 MySQL 不支持字面量 server_default，非空由 schema 默认 `""` 与应用层保证

### 2.3 依赖注入：require_header_org_role

`api/deps.py` 的 `require_header_org_role(*allowed_roles)` 是顶层资源组织隔离的唯一入口（与 `require_org_role` 判权逻辑一致，仅组织来源不同）：

```
X-Organization-Id 头缺失 / 非数字 → 403 FORBIDDEN（不泄露组织存在性）
  → db.get(Organization) 为空 → 404 ORGANIZATION_NOT_FOUND
  → 查 membership(org.id, user.id) 为空 → 403 NOT_ORG_MEMBER
  → membership.role.name 不命中 → 403 FORBIDDEN
  → 返回 (org, membership)
```

路由层定义 `OrgCtx`（owner/admin/member/viewer）与 `AdminCtx`（owner/admin）两个别名，10 个端点全部挂在这两个别名上；智能体归属（`agent.organization_id == org.id`）与版本归属（`version.agent_id == agent.id`）由 service 层校验。

### 2.4 接口明细

| 接口 | 成功 | 权限（依赖别名） | 关键实现点 |
| --- | --- | --- | --- |
| `POST /agents` `{name, description?, avatar_url?, status?, system_prompt?, model_provider, model_name, temperature?, max_tokens?, config_json?}` | 201 `AgentDetail` | AdminCtx | 事务：建 agent + 建 v1 + 指向 current_version_id；见 2.5 |
| `GET /agents` `?name=&status=` | 200 `AgentListItem[]` | OrgCtx | 批量映射 current_version_id → 版本号；V1 不分页 |
| `GET /agents/{agent_id}` | 200 `AgentDetail` | OrgCtx | 含当前版本完整配置 `current_version_detail` |
| `PATCH /agents/{agent_id}` `{name?, description?, avatar_url?}` | 200 `AgentDetail` | AdminCtx | 仅基础信息（D3）；可空字段 null 清空；name null → 422 |
| `PATCH /agents/{agent_id}/status` `{status}` | 200 `AgentDetail` | AdminCtx | `Literal["enabled","disabled"]`；独立端点保持职责单一 |
| `DELETE /agents/{agent_id}` | 204 | AdminCtx | 删 agent，版本随 DB 级联删除 |
| `GET /agents/{agent_id}/versions` | 200 `AgentVersionItem[]` | OrgCtx | 按 version 倒序；响应含计算字段 `is_current` |
| `POST /agents/{agent_id}/versions` `{system_prompt, model_provider, model_name, temperature?, max_tokens?, config_json?}` | 201 `AgentVersionItem` | AdminCtx | 序号 = max(version)+1；不自动发布；agent 行锁 + 唯一约束兜底冲突重试 |
| `POST /agents/{agent_id}/versions/{version_id}/publish` | 200 `AgentDetail` | AdminCtx | 行锁事务设 current_version_id 为目标版本 |
| `POST /agents/{agent_id}/versions/{version_id}/rollback` | 200 `AgentDetail` | AdminCtx | 与 publish 同机制（指回历史版本，不产生新版本） |

### 2.5 服务层关键实现（维护时勿破坏）

- **归属校验是数据隔离的第二道闸**：按 `agent_id` 操作必须校验 `agent.organization_id == org.id`（404 `AGENT_NOT_FOUND`）；按 `version_id` 操作必须校验 `version.agent_id == agent.id`（404 `AGENT_VERSION_NOT_FOUND`）
- **创建事务（agent + v1 + 指向）**：建 agent → flush → 建 v1 → flush → `agent.current_version_id = version.id` → **显式 `db.flush()`** 落库 UPDATE（`refresh()` 不保证触发 autoflush，曾实测丢失赋值）→ refresh 两个对象取回 server_default → commit；`IntegrityError` 兜底名称/序号并发冲突
- **onupdate 取回**：`updated_at` 带 `onupdate=func.now()`，任何 UPDATE（编辑/启停/发布/回滚）提交后必须 `db.refresh(agent)`，否则过期属性在 async 上下文懒加载抛 `MissingGreenlet`
- **名称唯一（D1）**：创建与改名前预查 + `IntegrityError` 兜底（并发）
- **局部更新**：PATCH 用 `exclude_unset`；description / avatar_url 传 null 表示清空，name 传 null → 422 `AGENT_FIELD_REQUIRED`
- **版本序号（并发安全）**：`next_version_number = max(version) + 1`；创建版本前以 `FOR UPDATE` 行锁读取 agent 串行化并发，`uq_agent_version_seq` 兜底，撞约束回滚重试（最多 3 次），仍失败抛 409 `AGENT_VERSION_CONFLICT`
- **发布 / 回滚共用 `_set_current`**：行锁读 agent → 校验版本归属 → 赋值 `agent.current_version_id` → commit → refresh；回滚不产生新版本
- **组织解散联动（D10）**：`OrganizationService.dissolve` 先 `agent_repo.delete_by_org(org.id)`（versions 随 CASCADE），再删成员关系、再删组织

### 2.6 测试体系

- 位置：`backend/tests/test_agent.py`，沿用 conftest 模式；清理链按外键顺序：版本 → 智能体 → 成员 → 组织 → 用户
- 14 个用例覆盖：创建（含 v1 自动发布、字段校验 422、非法 status 422）、名称冲突（创建 + 改名撞名 + 改自身原名）、列表过滤（name/status/非法 status 422）、未登录 401、请求头隔离（缺头 403 / 非数字 403 / 组织不存在 404 / 非成员 403）、跨组织 agent 404、viewer 只读（读 200 + 六类管理操作 403）、编辑基础信息（null 清空 / name null 422）、启停流转、删除（204 + 版本级联清空）、版本流转（建 v2 不发布 / 发布 / 回滚 / 版本不存在 404 / 跨 agent 版本 404）、组织解散级联删 agents 与 versions
- 全量回归：`pytest`（当前 53 passed，含 auth 16 例 + organization 23 例 + agent 14 例）

## 3. 前端实现

### 3.1 目录结构与依赖方向

```
frontend/src/
├─ api/agents.ts                     # agentApi（顶层 /agents，不含 orgId 路径参数）
├─ types/agent.ts                    # AgentStatus / CRUD / 版本请求响应类型
├─ constants/routes.ts               # 追加 AGENTS / AGENT_NEW / AGENT_DETAIL / AGENT_EDIT / AGENT_VERSION_NEW 与路径工具
├─ constants/agent-options.ts        # 状态中文文案 + PROVIDER 候选项 + canManageAgent
├─ hooks/useAgents.ts                # queryKey ['org', orgId, 'agents', name, status]
├─ hooks/useAgent.ts                 # useAgent + useAgentVersions（['org', orgId, 'agent', agentId, 'versions']）
├─ utils/http.ts                     # 请求拦截器注入 X-Organization-Id（setOrgIdProvider 由 main.tsx 装配）
├─ pages/agents/{List,Form,Detail,VersionForm}.tsx
└─ main.tsx / router/index.tsx       # 装配组织上下文提供者与新路由
```

依赖方向不变：`pages → hooks/stores/api/components → utils/constants/types`，不可反向。`utils/http.ts` 不反向依赖 stores——组织 id 经 `setOrgIdProvider` 注入。

### 3.2 状态与数据流

- **组织上下文（D9 前端落点）**：`main.tsx` 注册提供者——URL 命中 `/organizations/:orgId/*` 时取 URL 的 orgId（详情页唯一事实来源），否则回落 zustand `currentOrgId`；`utils/http.ts` 请求拦截器自动写入 `X-Organization-Id` 头。login/register/refresh 等认证接口无需该头（后端不校验）
- Query key 约定：`['org', orgId, 'agents', name ?? '', status ?? '']`、`['org', orgId, 'agent', agentId]`、`['org', orgId, 'agent', agentId, 'versions']`（orgId 参与 key 以便切换组织时自然换缓存，实际隔离仍靠请求头）
- 缓存联动（invalidate）：创建/编辑/启停 → 列表前缀失效 `['org', orgId, 'agents']`；版本流转（创建/发布/回滚）→ 版本 key + 详情 key + 列表；删除 → 列表失效 + `removeQueries` 详情与版本 key
- 角色可见性由 `canManageAgent` 纯函数收敛（owner/admin），后端为准

### 3.3 路由与导航

```
RequireAuth
└─ AppLayout
   ├─ /organizations/:orgId/agents                     List
   ├─ /organizations/:orgId/agents/new                 Form（创建态）
   ├─ /organizations/:orgId/agents/:agentId            Detail
   ├─ /organizations/:orgId/agents/:agentId/edit       Form（编辑态：仅基础信息）
   └─ /organizations/:orgId/agents/:agentId/versions/new   VersionForm（新建版本）
```

- 侧边栏「智能体管理」复用 `orgNavDisabled` 置灰逻辑；路由声明顺序：`/agents/new` 在 `/:agentId` 之前
- 前端路径仍含 orgId（用于组织上下文与缓存 key，D9 决策范围外的 UI 细节）；API 调用为顶层 `/agents`

### 3.4 页面布局设计（核心）

**3.4.1 列表页 List.tsx**（对齐需求 3.3 列表展示字段）

```
┌──────────────────────────────────────────────────────────┐
│ 智能体管理                     [＋ 新建智能体]   ← 页头   │
├──────────────────────────────────────────────────────────┤
│ [🔍 按名称搜索…]  [状态 ▾]  共 N 个            ← 工具条   │
├──────────────────────────────────────────────────────────┤
│ ┌──────────────┐ ┌──────────────┐               (1/2/3列)│
│ │ (头像) 名称    │ │              │   卡片 = 需求展示字段  │
│ │  [●状态] v2   │ │              │   名称/当前版本/状态/  │
│ │ 描述(2行截断) │ │              │   创建时间 + 操作      │
│ │ 创建于 xx     │ │              │                        │
│ └──────────────┘ └──────────────┘                        │
└──────────────────────────────────────────────────────────┘
```

- 卡片：头像（URL 或首字母圆）· 名称 · 状态徽章 · 「当前版本 vN」· 创建时间；操作列（owner/admin）「查看 / 编辑 / 行内启停开关」，删除仅 Detail 危险区
- 搜索受控输入即查（同 Members 邮箱过滤模式）

**3.4.2 表单页 Form.tsx（创建 / 编辑共用）**

- 创建态：左栏三分区表单（基础信息：名称/描述/头像/状态 + 模型配置：Provider/模型/Temperature 滑块/Max Tokens + 系统提示词）+ 右栏 sticky 实时预览卡；提交即创建并自动生成 v1 发布
- 编辑态：仅基础信息单列表单（D3：模型与提示词走版本页），保存后回详情
- 校验 RHF + zod（与后端 schema 同步）；模型配置必填在创建态由 `setError` 收敛

**3.4.3 版本表单页 VersionForm.tsx**

- 基于当前版本预填（Provider/模型/Temperature/Max Tokens/系统提示词），提交仅**创建版本**，回到详情页手动发布

**3.4.4 详情页 Detail.tsx**

```
┌──────────────────────────────────────────────────────────┐
│ ← 返回   (头像) 名称 [●状态] v2        [启停] [编辑]     │
├───────────────────────────────┬──────────────────────────┤
│ 基础信息（描述/创建者/时间）    │ 当前版本 v2（模型/参数/  │
│                               │ 系统提示词）             │
├───────────────────────────────┴──────────────────────────┤
│ 版本历史                    [＋ 新建版本]                 │
│ v2 provider/model 创建者·时间 [当前]                      │
│ v1 provider/model 创建者·时间 [回滚]                      │
├──────────────────────────────────────────────────────────┤
│ 危险区：删除智能体（输名称确认，版本一并清除）            │
└──────────────────────────────────────────────────────────┘
```

- 版本历史语义映射（需求 3.4）：非当前且序号**小于**当前 → 「回滚」；序号**大于**当前（未发布新版本）→ 「发布」
- 回滚二次确认（window.confirm）；发布/回滚成功后刷新版本 + 详情 + 列表缓存
- member/viewer 只读：无操作按钮与危险区（后端为准）

## 4. 关键流程时序

**4.1 创建智能体（含 v1 发布）**

1. List「新建」→ Form 创建态校验 → `POST /agents`（头带 X-Organization-Id）
2. 后端：AdminCtx → 名称冲突预查 → 事务建 agent + v1 → 显式 flush 指向 current_version_id → refresh → commit
3. 前端 invalidate 列表 → 跳详情页（展示当前版本 v1）

**4.2 编辑基础信息**

1. Detail / List「编辑」→ Form 编辑态回填 → `PATCH /agents/{id}`
2. 后端：归属校验 → `exclude_unset` 局部更新 → commit → refresh
3. 前端 invalidate 详情 + 列表 → 回详情

**4.3 新建版本与发布 / 回滚**

1. Detail「新建版本」→ VersionForm（基于当前 v 预填）→ `POST /agents/{id}/versions`
2. 后端：版本号 +1，仅创建不发布 → 前端刷新版本列表
3. 发布：`POST .../versions/{vid}/publish`；回滚：`POST .../versions/{vid}/rollback`——同一 `_set_current` 事务更新 `current_version_id` → refresh → 详情联动刷新

**4.4 启停 / 删除**

1. 启停：List 行内开关 / Detail 页头按钮 → `PATCH .../status` → 刷新对应缓存
2. 删除：Detail 危险区输名称确认 → `DELETE /agents/{id}` → 版本随 DB 级联清理 → 前端 removeQueries 详情 → 跳列表

**4.5 组织解散联动（跨模块，D10）**

1. Settings 解散 → `DELETE /organizations/{org_id}`
2. 后端 dissolve 事务顺序：先删 agents（versions 级联）→ 删成员关系 → 删组织 → commit

## 5. 错误码对照表

| 后端 code | HTTP | 触发场景 | 前端展示 |
| --- | --- | --- | --- |
| `AGENT_NOT_FOUND` | 404 | agent 不存在，或不属于当前组织（归属校验统一返回，不泄露存在性） | 后端 message（智能体不存在） |
| `AGENT_NAME_CONFLICT` | 409 | 创建 / 改名时名称在组织内已存在（预查 + 唯一约束兜底） | 后端 message（名称已存在） |
| `AGENT_FIELD_REQUIRED` | 422 | PATCH 时 name 显式传 null | 后端 message（名称不能为空） |
| `AGENT_VERSION_NOT_FOUND` | 404 | 版本不存在或不属于该 agent（发布/回滚路径） | 后端 message（智能体版本不存在） |
| `AGENT_VERSION_CONFLICT` | 409 | 并发生成同序号版本，重试 3 次仍撞唯一约束 | 后端 message（版本创建冲突，请重试） |
| （Pydantic 422） | 422 | 名称长度、temperature 越界、max_tokens 越界、status/model_provider/model_name 非法或缺省 | 前端 zod 先行拦截，透传后端 message |
| 复用 `FORBIDDEN` | 403 | X-Organization-Id 缺失/非数字；member/viewer 管理操作（AdminCtx 不命中） | 后端 message |
| 复用 `ORGANIZATION_NOT_FOUND` | 404 | 请求头组织不存在 | 后端 message |
| 复用 `NOT_ORG_MEMBER` | 403 | 当前用户不是请求头组织成员（数据隔离） | 后端 message |
| （非业务错误） | — | 网络中断、超时等 axios 错误 | `errorMessage()` 兜底「网络异常，请稍后重试」 |

响应体格式统一为 `{code, message, detail}`（`main.py` 全局异常处理器输出）；`message` 即前端直接展示文案，保持中文。

## 6. 维护约定与约束

以下约定在修改前必须了解设计意图，避免引入回退：

1. **Agent 接口一律顶层 `/agents` + `X-Organization-Id` 请求头（D9）**：组织校验唯一入口是 `require_header_org_role` 别名（OrgCtx / AdminCtx），service 层禁止再查 membership；后端不接受路径或 query 传组织 id
2. **归属校验是第二道闸**：agent 校验 `organization_id == org.id`，版本校验 `agent_id == agent.id`，均返回 404（不泄露跨组织存在性）
3. **配置版本化（D2/D3）**：模型配置与提示词只存在于 `agent_versions`；PATCH 不得引入配置字段，配置变更一律走「新建版本 → 发布/回滚」
4. **环形外键不可建 ORM relationship**：`agents.current_version_id ↔ agent_versions.agent_id` 互指，加载一律显式查询（`_current_version` / `list_versions`），避免懒加载与 `MissingGreenlet`
5. **创建事务必须显式 flush 再 refresh**：`current_version_id` 的 post-flush 赋值依赖显式 `db.flush()`（曾实测 refresh 不触发 autoflush 导致赋值丢失）；任何 UPDATE 提交后 refresh 取回 `updated_at`（onupdate）
6. **名称唯一（D1）与版本序号**：预查 409 + `IntegrityError` 兜底缺一不可；版本序号 = `max(version)+1`，唯一约束兜底并发
7. **组织解散必须先删 agents（D10）**：`dissolve` 事务顺序 agents（versions 级联）→ 成员关系 → 组织，不得破坏
8. **Query key 联动**：按 3.2 的联动表同步 invalidate；删除必须 `removeQueries` 详情与版本 key；orgId 在 key 中仅作缓存隔离，实际隔离靠请求头
9. **前端角色可见性与后端同步维护**：`canManageAgent` 与权限矩阵一一对应；改矩阵时两处同改，后端为准
10. **若未来绑定知识库 / 工具（需求 3.3 编辑 + 3.6/3.7）**：新增关联表（需求 4.7 agent_tools 等）并新建 Alembic 迁移；接口按需求 3.7 挂 `/agents/{id}/tools`，不修改已执行迁移
11. **chat / 日志模块落地后复审 D6**：一旦 agents 被对话记录引用，需重新评估硬删除 → 级联 / 软删策略
12. **测试沿用 conftest 模式**：清理链已按外键顺序（版本 → 智能体 → 成员 → 组织 → 用户）；新增错误码 message 保持中文（前端透传路径）