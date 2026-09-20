# Agent 智能体管理模块设计文档

> 本文档描述 Agent 智能体管理模块的**当前实际实现**，以代码为准，供后期维护与迭代参考。体例沿用《Auth 模块设计文档》（`docs/模块设计文档/auth.md`）与《Organization 组织管理模块设计文档》（`docs/模块设计文档/organization.md`）。
> 范围：组织作用域内智能体的创建 / 列表 / 详情 / 编辑 / 启停 / 删除（6 个后端接口 + 前端列表、表单、详情三个页面）。用户认证与组织 RBAC 见 auth.md / organization.md。所有文件引用均为相对路径。

## 1. 模块概述

功能清单：

- 智能体：创建、列表（名称模糊过滤 + 状态过滤）、详情、编辑、启停、删除，全部挂在组织下（组织作用域数据隔离）
- 配置项：名称、描述、系统提示词（System Prompt）、LLM Provider、模型名、Temperature、Max Tokens、启用状态

需求来源：README Roadmap V1「Agent Management」+「Create an Agent」核心流程（Configure: System Prompt / LLM Provider / Model / Temperature / Max Tokens / Knowledge Bases / Tools）。

产品决策（基线，改动需同步本文档）：

| # | 决策 | 说明 |
| --- | --- | --- |
| D1 | 名称组织内唯一（1–100 字符），不做全局唯一 | `uq_agent_name(organization_id, name)` 保证，多组织可同名 |
| D2 | V1 **不绑定知识库 / 工具** | 对应模块尚未实现；后续接入时新增关联表并走新迁移，不改已执行迁移 |
| D3 | provider / model 为自由文本（仅长度校验），V1 不做 LLM 连通性测试 | 模型网关接入与连通性验证由聊天模块统一约束 |
| D4 | 启停即时生效、不删除配置 | `status ∈ {enabled, disabled}`；disabled 仅影响后续对话运行（chat 模块校验），本模块只管理状态 |
| D5 | 删除为硬删除（V1 无关联数据） | chat / 执行日志模块落地后重新评估级联与软删 |
| D6 | 列表 V1 全量返回 + `name` 模糊 + `status` 过滤，不分页 | 与 organization.md D6 一致，数据量可控后平滑加分页 |
| D7 | 权限以组织角色为准：owner/admin 可管理，member/viewer 只读 | `created_by` 仅记录创建者，不参与权限判定 |
| D8 | 组织解散须同事务先删该组织全部 agents（FK 顺序） | 需小幅调整 organization 模块的 `dissolve`（见 2.4） |

前后端对应关系：

| 功能 | 后端接口 | 前端实现 |
| --- | --- | --- |
| 创建 | `POST /api/v1/organizations/{org_id}/agents` | `pages/agents/Form.tsx`（新建态） |
| 列表 | `GET /api/v1/organizations/{org_id}/agents` `?name=&status=` | `hooks/useAgents.ts` → `pages/agents/List.tsx` |
| 详情 | `GET /api/v1/organizations/{org_id}/agents/{agent_id}` | `hooks/useAgent.ts` → `pages/agents/Detail.tsx` |
| 编辑 | `PATCH /api/v1/organizations/{org_id}/agents/{agent_id}` | `pages/agents/Form.tsx`（编辑态）+ Detail 入口 |
| 启停 | `PATCH /api/v1/organizations/{org_id}/agents/{agent_id}/status` | List 卡片开关 / Detail 页头按钮 |
| 删除 | `DELETE /api/v1/organizations/{org_id}/agents/{agent_id}` | `pages/agents/Detail.tsx`（危险区） |

权限矩阵（组织内，后端为准、前端按角色隐藏入口）：

| 操作 | owner | admin | member | viewer |
| --- | --- | --- | --- | --- |
| 查看列表 / 详情 | ✔ | ✔ | ✔ | ✔ |
| 创建 | ✔ | ✔ | — | — |
| 编辑 | ✔ | ✔ | — | — |
| 启停 | ✔ | ✔ | — | — |
| 删除 | ✔ | ✔ | — | — |

## 2. 后端实现

### 2.1 目录结构与分层

本模块新增 / 修改的文件：

```
backend/
├─ alembic/versions/20260919_0002_create_agents_table.py   # 迁移：agents 表
├─ app/
│  ├─ api/v1/agents.py            # 6 个端点（prefix=/organizations/{org_id}/agents）
│  ├─ api/v1/router.py            # 追加挂载 agents.router
│  ├─ core/exceptions.py          # 追加 AgentNotFound / AgentNameConflict / AgentFieldRequired
│  ├─ models/agent.py             # Agent 模型
│  ├─ models/__init__.py          # 追加导出 Agent
│  ├─ schemas/agent.py            # 请求/响应模型（含 AgentStatus）
│  ├─ repositories/agent_repo.py  # agents 数据访问（含 delete_by_org 供解散联动）
│  ├─ services/agent_service.py   # 业务逻辑与归属校验
│  ├─ services/organization_service.py  # dissolve 先删 agents（D8）
└─ tests/test_agent.py            # 12 个集成用例；conftest 清理链追加 Agent
```

分层链路与 auth / organization 模块一致：`router → AgentService → AgentRepository → SQLAlchemy`。路由层不写业务与 SQL；权限复用 `require_org_role` 的组织作用域别名，service 层**只补智能体的归属校验**（`agent.organization_id == org.id`），不再重复查询成员关系。

### 2.2 数据模型（新迁移 20260919_0002）

`agents` 表（命名与字段风格沿用 `users` / `organizations`）：

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| `id` | BigInteger | PK, autoincrement | — |
| `organization_id` | BigInteger | FK→`organizations.id`, not null | 索引 `ix_agents_organization_id` |
| `name` | VARCHAR(100) | not null | 组织内唯一（D1） |
| `description` | VARCHAR(500) | nullable | — |
| `system_prompt` | TEXT | not null, server_default `''` | 系统提示词 |
| `provider` | VARCHAR(50) | not null | LLM Provider（自由文本，D3） |
| `model` | VARCHAR(100) | not null | 模型名（自由文本，D3） |
| `temperature` | DECIMAL(3,2) | nullable | 0.00–2.00；null 表示取运行时默认 |
| `max_tokens` | Integer | nullable | 1–100000；null 表示取运行时默认 |
| `status` | VARCHAR(20) | not null, server_default `'enabled'` | `enabled` / `disabled` |
| `created_by` | BigInteger | FK→`users.id`, not null | 仅记录，不参与权限（D7） |
| `created_at` / `updated_at` | DateTime | server_default / onupdate 同现有表 | — |

- 唯一约束：`uq_agent_name(organization_id, name)`
- ORM 关系：V1 不建立与 users / organizations 的 relationship（查询只需 `organization_id` 过滤），避免不必要的加载开销；如详情页需显示创建者用户名，查询时显式 `selectinload` 或子查询取用户名

### 2.3 接口明细

| 接口 | 成功 | 权限（依赖别名） | 关键实现点 |
| --- | --- | --- | --- |
| `POST /organizations/{org_id}/agents` `{name, description?, provider, model, temperature?, max_tokens?, system_prompt?}` | 201 `AgentDetail` | AdminCtx | 名称冲突预查 409 + `IntegrityError` 兜底；`db.refresh` 取回 created_at |
| `GET /organizations/{org_id}/agents` `?name=&status=` | 200 `AgentListItem[]` | OrgCtx | 组织内过滤；name 模糊 + status 精确（`Literal` 经 Query 校验）；V1 不分页 |
| `GET /organizations/{org_id}/agents/{agent_id}` | 200 `AgentDetail` | OrgCtx | 归属校验：非本组织 agent 一律 404 `AGENT_NOT_FOUND`（不泄露存在性） |
| `PATCH /organizations/{org_id}/agents/{agent_id}` `{同上全可选}` | 200 `AgentDetail` | AdminCtx | 全字段可选（`model_config` 或手工判定 `exclude_unset`）；改名冲突规则同创建 |
| `PATCH /organizations/{org_id}/agents/{agent_id}/status` `{status}` | 200 `AgentDetail` | AdminCtx | `status: Literal["enabled","disabled"]`；独立端点避免编辑接口旁路 |
| `DELETE /organizations/{org_id}/agents/{agent_id}` | 204 | AdminCtx | 硬删除（D5）；归属校验同详情 |

> 复用 organization.md 的依赖别名约定：`OrgCtx`（owner/admin/member/viewer）、`AdminCtx`（owner/admin）。本模块所有端点挂在 `{org_id}` 路径下，`require_org_role` 自动完成组织存在 / 成员身份 / 角色三重校验，service 层不得再查 membership。

### 2.4 服务层关键设计（实施时勿破坏）

- **归属校验是数据隔离的第二道闸**：所有按 `agent_id` 操作的接口在 `db.get(Agent, agent_id)` 后必须校验 `agent.organization_id == org.id`，否则返回 404 `AGENT_NOT_FOUND`（用 404 而非 403，不对外暴露其他组织的 agent 是否存在）
- **名称唯一（D1）**：创建与改名（含改名到同名）前预查 `uq_agent_name` → 409 `AGENT_NAME_CONFLICT`；并发下由唯一约束抛 `IntegrityError` 兜底（模式同 organization.md 的添加成员）
- **server_default / onupdate 取回**：MySQL 无 RETURNING。创建后必须 `db.refresh(agent)` 拿回 `created_at` / `status`；**更新 / 启停提交后同样必须 `db.refresh(agent)`**——`updated_at` 带 `onupdate=func.now()`，UPDATE 后该属性过期，async 上下文中的懒加载会抛 `MissingGreenlet`（曾实测复现的 bug，与 organization.md 记录的关系懒加载同源）
- **system_prompt 无 DB 默认值**：TEXT 列在 MySQL 不支持字面量 server_default，故建表时无默认值；由 schema 默认 `""` 与应用层保证非空，更新时传 null 的清空语义为回退空串
- **组织解散联动（D8）**：`OrganizationService.dissolve` 同事务内先 `agent_repo.delete_by_org(org.id)`，再删成员关系、再删组织（FK 顺序），否则外键约束会阻止解散
- **PATCH 局部更新**：`AgentUpdateRequest` 全字段可选，用 `exclude_unset` 判定后进行字段赋值；可空字段（description/temperature/max_tokens/system_prompt）传 null 表示清空，必填字段（name/provider/model）传 null → 422 `AGENT_FIELD_REQUIRED`
- 创建 / 编辑 / 删除均为单事务（沿用 `session.commit()` 模式），不做部分提交

### 2.5 测试体系

- 位置：`backend/tests/test_agent.py`，沿用 conftest 模式（测试库自动建库迁移、`dependency_overrides`、每用例清空业务表；清理链已追加先删 Agent，满足外键顺序）
- 12 个用例覆盖：创建与校验（422：名称长度 / temperature 越界 / max_tokens 越界 / 缺 provider）、名称冲突（创建 409 + 改名撞名 409 + 改名为自身原名 200）、列表过滤（name 模糊 / status 过滤 / 非法 status 422）、未登录 401、非成员 403（NOT_ORG_MEMBER）、viewer 只读（读 200 + 四类管理操作 403）、归属隔离（不存在 404 + 跨组织 agent_id 404 `AGENT_NOT_FOUND`）、局部编辑（只改已传字段 + 可空字段置 null 清空 + system_prompt null 回退空串 + 必填 null 422 `AGENT_FIELD_REQUIRED` + 空请求体不变）、启停流转与非法值 422、删除后查无 404、组织解散级联删除 agents（D8，直接查库断言）
- 全量回归：`pytest`（当前 51 passed，含 auth 16 例 + organization 23 例 + agent 12 例）

## 3. 前端实现与页面布局

### 3.1 目录结构与依赖方向

```
frontend/src/
├─ api/agents.ts                     # agentApi（api/index.ts 追加导出）
├─ types/agent.ts                    # AgentStatus / 各请求响应类型（index.ts 追加导出）
├─ constants/routes.ts               # 追加 ROUTE_PATHS 与 agentsPath / agentDetailPath / agentEditPath 工具
├─ constants/agent-options.ts        # PROVIDER 常用选项 + 状态中文文案（复用 org-roles.ts 的文案常量模式）
├─ hooks/useAgents.ts                # queryKey ['org', orgId, 'agents', {name, status}]
├─ hooks/useAgent.ts                 # queryKey ['org', orgId, 'agent', agentId]
├─ components/layout/AppLayout.tsx   # 修改：侧边栏追加「智能体管理」导航
└─ pages/agents/{List,Form,Detail}.tsx
```

依赖方向不变：`pages → hooks/stores/api/components → utils/constants/types`，不可反向。

### 3.2 路由与导航

```
RequireAuth
└─ AppLayout
   ├─ /organizations/:orgId/agents            List  智能体管理
   ├─ /organizations/:orgId/agents/new        Form  创建（新建态）
   ├─ /organizations/:orgId/agents/:agentId   Detail  智能体详情
   └─ /organizations/:orgId/agents/:agentId/edit  Form  编辑（编辑态）
```

- 侧边栏在「成员管理」下方追加「智能体管理」，复用现有 `orgNavDisabled` 置灰逻辑（无组织时置灰）；创建 / 编辑两个 Form 入口不由侧边栏导航，从 List / Detail 页进入
- 路由声明顺序约束：`/agents/new` 必须声明在 `/agents/:agentId` **之前**（同 organization.md 中 `members/me` 的既有约束）

### 3.3 状态与数据流

- Query key 约定：`['org', orgId, 'agents', name ?? '', status ?? '']`（name/status 恒占两个槽位，无筛选时为空串）与 `['org', orgId, 'agent', agentId]`
- 缓存联动（invalidate）：创建/编辑/启停/删除 → `['org', orgId, 'agents']`（前缀失效，覆盖所有筛选组合）；编辑/启停 → 另失效 `['org', orgId, 'agent', agentId]`；删除 → 另 `removeQueries` 该 agent 的详情 key
- `orgId` / `agentId` 取自 `useParams`（URL 是唯一事实来源，同组织模块约定）；无 `currentOrgId` 或落在非法路径时由现有 RequireAuth / OrgSwitcher 回落机制兜底
- 角色可见性由纯函数收敛（`constants/agent-options.ts`，同 organization.md）：`canManageAgent(myRole)` = owner/admin，前端据此隐藏「新建 / 编辑 / 启停 / 删除」入口，后端为准；Form 页对 member/viewer 直显「没有权限管理智能体」兜底（后端为准）

### 3.4 页面布局设计（核心）

统一沿用 Tailwind + 现有视觉语言（indigo 主色、neutral 灰阶、卡片圆角），内容区为 AppLayout 右侧 Outlet。

**3.4.1 列表页 List.tsx**

```
┌──────────────────────────────────────────────────────────┐
│ 智能体管理                     [＋ 新建智能体]   ← 页头   │
│ 智能体配置、启停与生命周期管理（副标题）                   │
├──────────────────────────────────────────────────────────┤
│ [🔍 按名称搜索…]  [状态 ▾ 全部/已启用/已停用]  共 N 个   ← 工具条
├──────────────────────────────────────────────────────────┤
│ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐          │
│ │ 名 称 [●启用]│ │ 名称 [○停用] │ │ 名称        │          │
│ │ 描述（2 行截断）│ │ …           │ │ …           │  ← 卡片 │
│ │ model/provider│ │            │ │            │   网格   │
│ │ 更新于 xx    │ │            │ │            │ (1/2/3列) │
│ │ [查看][编辑] │ │            │ │            │          │
│ └─────────────┘ └─────────────┘ └─────────────┘          │
└──────────────────────────────────────────────────────────┘
```

- 卡片承载：名称 + 状态徽章（绿=启用 / 灰=停用）、描述（2 行截断）、`provider / model` 组合徽章、更新时间；操作列「查看 / 编辑」（owner/admin 另见开关与删除入口：开关直接用行内 toggle 调启停接口，删除放 Detail 危险区，避免列表页误删）
- 搜索框受控输入，change 即重新查询（与 Members 页 email 过滤同模式）；状态下拉过滤
- 空状态：无结果时展示引导文案 + 「新建智能体」按钮；member/viewer 隐藏页头新建按钮与卡片操作，仅读卡片

**3.4.2 表单页 Form.tsx（创建 / 编辑共用，左右分栏）**

```
┌───────────────────────────────┬──────────────────────┐
│ 基础信息                     │  Agent 实时预览（sticky）│
│ 名称*  [____________]        │  ┌──────────────────┐ │
│ 描述   [____________]        │  │ 名称  [●启用]     │ │
│                              │  │ 描述              │ │
│ 模型配置                     │  │ [provider/model] │ │
│ Provider* [____] Model* [__] │  │ temp 0.70 · tok — │ │
│ Temperature ──●── 0.70      │  └──────────────────┘ │
│ Max Tokens  [______]        │  提示词 N 字符        │
│                              │                      │
│ 系统提示词                   │  [取消] [保存]  ← 提交栏│
│ ┌────────────────────────┐  │                      │
│ │ (等宽字体大文本框)       │  │                      │
│ └────────────────────────┘  │                      │
└──────────────────────────────┴──────────────────────┘
```

- 左栏（约 2/3 宽）三个分区卡片：基础信息 → 模型配置 → 系统提示词，纵向滚动；右栏（约 1/3 宽，`sticky`）实时预览卡 + 提交栏，表单值变化即刷新预览（无需额外状态，直读 RHF watch）
- 窄屏（`lg` 以下）单列布局，预览卡折叠为底部摘要条
- 校验沿用 RHF + zod，与后端 `schemas/agent.py` 同步：名称 1–100、provider 1–50、model 1–100、temperature 0–2（zod `refine`）、max_tokens 可选 1–100000、system_prompt ≤ 10000（长度上限需与后端一致，见 3.5 待确认项）
- 编辑态用 `useAgent(orgId, agentId)` 回填；保存成功 invalidate 列表 + 详情，编辑态回详情页、新建态跳详情页

**3.4.3 详情页 Detail.tsx**

```
┌──────────────────────────────────────────────────────────┐
│ ← 返回  名 称 [●启用]        [停用/启用] [编辑] [删除]   ← 页头
├──────────────────────────────────────────────────────────┤
│ ┌───────────────┬──────────────────────────────────┐    │
│ │ 模型配置      │  系统提示词（等宽、可滚动、全文）  │    │
│ │ provider/model│                                  │    │
│ │ temperature   │                                  │    │
│ │ max_tokens    │                                  │    │
│ │ 创建者/时间    │                                  │    │
│ └───────────────┴──────────────────────────────────┘    │
├──────────────────────────────────────────────────────────┤
│ 危险区                                                   │
│ 删除智能体：输入名称确认 → [删除]（样式同组织解散危险区） │
└──────────────────────────────────────────────────────────┘
```

- 页头操作按 `canManageAgent` 渲染（member/viewer 只读）；「停用/启用」为状态切换按钮，调启停接口
- 危险区删除：输入完整名称才可提交（复用组织解散的交互模式）
- 详情页同时作为后续「与智能体对话」的入口锚点，V1 仅预留布局不实现（chat 模块落地时在此加「开始对话」按钮）

### 3.5 前端细节与待确认项

- Provider 下拉给出常用候选项（如 openai / anthropic / zhipu / deepseek）但允许自由输入（D3 配套，用可编辑 combobox 或 datalist）
- 错误文案透传后端中文 message，网络异常走 `errorMessage()` 兜底（沿用现有路径）
- 待实施时确认：system_prompt 的长度上限（对应后端 `Field(max_length=...)`），建议 10000 字符并在 zod / Pydantic 两端同步

## 4. 关键流程时序

**4.1 创建智能体**

1. List 页「新建」→ Form 新建态 → 校验通过 → `POST /organizations/{org_id}/agents`
2. 后端：AdminCtx 校验 → 名称冲突预查（409）→ 插入（唯一约束兜底）→ `db.refresh` → commit
3. 前端 invalidate `['org', orgId, 'agents']` → 跳 `/organizations/:orgId/agents/:newId`（详情页）

**4.2 编辑智能体**

1. Detail / List「编辑」→ Form 编辑态回填 → `PATCH /organizations/{org_id}/agents/{agent_id}`
2. 后端：归属校验（他组织 404）→ `exclude_unset` 局部更新 → 改名冲突规则同创建 → commit
3. 前端 invalidate 列表 + 详情 → 回详情页

**4.3 启停**

1. List 卡片行内 toggle 或 Detail 页头按钮 → `PATCH .../agents/{agent_id}/status`
2. 后端：Literal 校验 → 更新 status → commit
3. 前端 invalidate 列表 + 详情，状态徽章即时刷新（disabled 仅记录，运行侧影响由 chat 模块处理，D4）

**4.4 删除智能体**

1. Detail 危险区输入名称匹配 → `DELETE /organizations/{org_id}/agents/{agent_id}`
2. 后端：归属校验 → 硬删除 → commit（D5）
3. 前端 invalidate 列表 + `removeQueries` 详情 → 跳 `/organizations/:orgId/agents`

**4.5 组织解散联动（跨模块）**

1. Settings 解散（沿用 organization 4.6 流程）→ `DELETE /organizations/{org_id}`
2. 后端 `dissolve` 事务顺序：先删该组织全部 agents（D8）→ 删成员关系 → 删组织 → commit
3. 前端不变：清空组织上下文并跳转；其组织下的 agent 缓存随 `['org', orgId, ...]` 前缀一并清理

## 5. 错误码对照表

| 后端 code | HTTP | 触发场景 | 前端展示 |
| --- | --- | --- | --- |
| `AGENT_NOT_FOUND` | 404 | agent 不存在，或不属于当前组织（归属校验统一返回，不泄露存在性） | 后端 message（智能体不存在） |
| `AGENT_NAME_CONFLICT` | 409 | 创建 / 改名时名称在组织内已存在（预查 + 唯一约束兜底） | 后端 message（名称已存在） |
| `AGENT_FIELD_REQUIRED` | 422 | 更新时 name / provider / model 显式传 null | 后端 message（如「模型提供方不能为空」） |
| （Pydantic 422） | 422 | 名称长度、temperature 越界、max_tokens 越界、status 非法值、缺必填字段 | 前端 zod 先行拦截，透传后端 message |
| 复用 `ORGANIZATION_NOT_FOUND` | 404 | 组织不存在 / 非成员访问（依赖层抛出） | 后端 message |
| 复用 `NOT_ORG_MEMBER` | 403 | 当前用户不是该组织成员（数据隔离） | 后端 message |
| 复用 `FORBIDDEN` | 403 | member/viewer 发起管理操作（AdminCtx 不命中） | 后端 message |
| （非业务错误） | — | 网络中断、超时等 axios 错误 | `errorMessage()` 兜底「网络异常，请稍后重试」 |

响应体格式统一为 `{code, message, detail}`（`main.py` 全局异常处理器输出）；`message` 即前端直接展示文案，保持中文。

## 6. 维护约定与约束

以下约定在实施与后续修改时必须遵守，避免引入回退：

1. **Agent 接口一律挂 `/organizations/{org_id}/agents`**：组织存在 / 成员身份 / 角色三重校验由 `require_org_role` 别名（OrgCtx / AdminCtx）完成，service 层禁止再查 membership
2. **归属校验是第二道闸**：任何按 `agent_id` 操作的路径必须校验 `agent.organization_id == org.id`，否则 404 `AGENT_NOT_FOUND`（不泄露跨组织存在性）
3. **名称唯一（D1）**：预查 409 + `IntegrityError` 兜底缺一不可（并发场景），改名（含未改名提交）同样走该规则
4. **组织解散必须先删 agents（D8）**：`dissolve` 事务内的删除顺序为 agents → 成员关系 → 组织，调整 organization 模块时不得破坏该顺序
5. **新对象/更新后取回 server_default 与 onupdate**：创建后必须 `db.refresh`（created_at / status）；**更新与启停提交后同样必须 `db.refresh`**，否则 `updated_at`（onupdate）过期后会在 async 上下文触发懒加载并抛 `MissingGreenlet`
6. **system_prompt 不在 DB 层设默认值**：TEXT 列不支持字面量 server_default；非空由 schema 默认 `""` 与应用层保证，勿在迁移中给 TEXT 列加普通默认值
7. **status 仅 `enabled` / `disabled` 两值**：由 `Literal` 与 DB 默认值双重约束；启停走独立端点，禁止在通用 PATCH 中夹带 status（保持职责单一）
8. **Query key 联动**：按 3.3 的联动表同步 invalidate；删除必须 `removeQueries` 详情 key，防止回详情页读到陈旧缓存
9. **前端角色可见性与后端同步维护**：`canManageAgent` 与权限矩阵一一对应；改矩阵时两处同改，后端为准
10. **若未来绑定知识库 / 工具（推翻 D2）**：新增关联表并新建 Alembic 迁移，不修改已执行的迁移文件
11. **chat / 日志模块落地后复审 D5**：一旦 agents 被对话记录引用，需重新评估硬删除 → 级联 / 软删策略，并同步更新本文档
12. **测试沿用 conftest 模式**：清理链已按外键顺序先删 Agent；新增用例复用测试库准备与清理机制；新增错误码 message 保持中文（前端透传路径）