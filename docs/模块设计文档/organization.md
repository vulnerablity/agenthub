# Organization 组织管理模块设计文档

> 本文档描述 Organization 组织管理模块的**当前实际实现**，以代码为准，供后期维护与迭代参考。
> 范围：组织 CRUD 与成员管理（10 个后端接口 + 前端 AppLayout 布局与四个业务页）。用户认证与 Token 机制见《Auth 模块设计文档》（`docs/模块设计文档/auth.md`）。所有文件引用均为相对路径。

## 1. 模块概述

功能清单：

- 组织：创建（创建者自动成为 owner 成员）、我的组织列表、组织详情、改名（owner/admin）、解散（owner）
- 成员：成员列表（按邮箱模糊过滤）、添加已注册用户（owner/admin）、修改成员角色（owner/admin）、owner 转让（仅 owner）、移除成员（owner/admin）、本人退出（owner 除外）

需求来源：`docs/需求文档 V1.0.md` 3.2 组织管理、2.1–2.4 用户角色、4.2/4.3 数据表、8 验收标准第 2 条（创建企业组织）。

需求覆盖对照（以《需求文档 V1.0》为准）：

| 需求条款 | 需求内容 | 实现 | 说明 |
| --- | --- | --- | --- |
| 3.2 | 创建组织 | `POST /api/v1/organizations` | 一致；创建者自动成为 owner（需求 2.3「Owner 创建组织」的落地：先有组织才有组织内角色） |
| 3.2 | 添加成员 | `POST /api/v1/organizations/{org_id}/members` | 一致（仅支持已注册用户，见 D1） |
| 3.2 | 删除成员 | `DELETE .../members/{user_id}`（+ 本人退出 `/me`） | 一致 |
| 3.2 | 设置角色 | `PATCH .../members/{user_id}`（含转让） | 一致 |
| 2.1–2.4 | 角色定义 | roles 预置 owner/admin/member/viewer | 一致；中文名统一：企业拥有者 / 管理员 / 普通用户 / 查看者 |
| 4.2 / 4.3 | 数据表结构 | organizations / organization_members | 字段逐一对齐 |
| 2.3 | Owner 管理全部资源 | 改名 / 解散 / 转让 / 退出 / 组织列表与详情（需求未列明细，属合理扩展） | 不冲突，保留 |

产品决策（基线，改动需同步本文档）：

| # | 决策 | 说明 |
| --- | --- | --- |
| D1 | 只支持添加**已注册**用户，不做未注册邮箱邀请 | 复用 auth 模块三表，无 invites 表、无新迁移 |
| D2 | 组织名仅校验 1–100 字符，**不做全局唯一** | 多租户下允许同名 |
| D3 | 用户可加入多个组织，同组织内唯一 | `uq_org_member(organization_id, user_id)` 已保证 |
| D4 | 转让后旧 owner 自动降为 `admin` | 保留管理权，转让不等于被请出 |
| D5 | `organizations.owner_id` 与 owner 角色的成员保持强一致 | 转让事务内同步两处 |
| D6 | 成员列表 V1 全量返回 + `email` 模糊过滤参数，不分页 | 数据量可控，后续可平滑加分页 |

前后端对应关系：

| 功能 | 后端接口 | 前端实现 |
| --- | --- | --- |
| 创建组织 | `POST /api/v1/organizations` | `pages/organizations/List.tsx` → `api/organizations.ts` |
| 我的组织列表 | `GET /api/v1/organizations` | `hooks/useMyOrganizations.ts`（List / Home / OrgSwitcher 共用） |
| 组织详情 | `GET /api/v1/organizations/{org_id}` | `hooks/useOrg.ts` |
| 改名 | `PATCH /api/v1/organizations/{org_id}` | `pages/organizations/Settings.tsx` |
| 解散 | `DELETE /api/v1/organizations/{org_id}` | `pages/organizations/Settings.tsx`（危险区） |
| 成员列表 | `GET /api/v1/organizations/{org_id}/members` | `hooks/useOrgMembers.ts` → `pages/organizations/Members.tsx` |
| 添加成员 | `POST /api/v1/organizations/{org_id}/members` | `pages/organizations/Members.tsx` |
| 改角色 / 转让 | `PATCH /api/v1/organizations/{org_id}/members/{user_id}` | Members（行内下拉）/ Settings（转让） |
| 退出 | `DELETE /api/v1/organizations/{org_id}/members/me` | Members（本人行「退出组织」） |
| 移除成员 | `DELETE /api/v1/organizations/{org_id}/members/{user_id}` | Members（操作列「移除」） |

权限矩阵（组织内，后端为准、前端按角色隐藏入口）：

| 操作 | owner | admin | member | viewer |
| --- | --- | --- | --- | --- |
| 查看组织详情 / 成员列表 | ✔ | ✔ | ✔ | ✔ |
| 改名 | ✔ | ✔ | — | — |
| 添加成员（角色限 admin/member/viewer） | ✔ | ✔ | — | — |
| 修改 member/viewer 角色 | ✔ | ✔ | — | — |
| 修改 admin 角色 / 移除 admin | ✔ | — | — | — |
| 移除成员 | ✔（全部） | ✔（限 member/viewer） | — | — |
| 转让（role→owner，旧 owner 降 admin） | ✔ | — | — | — |
| 解散 | ✔ | — | — | — |
| 本人退出 | —（须先转让） | ✔ | ✔ | ✔ |

## 2. 后端实现

### 2.1 目录结构与分层

本模块新增文件：

```
backend/app/
├─ api/deps.py                    # 追加 require_org_role（组织作用域 RBAC）
├─ api/v1/organizations.py        # 组织 + 成员共 10 个端点
├─ api/v1/router.py               # 追加挂载 organizations.router
├─ core/exceptions.py             # 追加 11 个组织域错误码
├─ schemas/organization.py        # 请求/响应模型（含 OrgRoleName / AssignableRoleName）
├─ repositories/organization_repo.py  # organizations / organization_members 数据访问
├─ services/organization_service.py   # 业务逻辑与权限判定
└─ tests/test_organization.py     # 23 个集成用例
```

分层链路与 auth 模块一致：`router → OrganizationService → OrganizationRepository → SQLAlchemy`。路由层不写业务与 SQL；`require_org_role` 完成组织存在性、成员身份、角色三重校验后把 `(org, membership)` 上下文传入 handler，service 层**不再重复查询成员关系**。

### 2.2 数据模型（复用，零改动）

本模块复用 auth 模块迁移 `20260918_0001` 建好的四张表，**无新表、无新字段、无新迁移**：

- `organizations`：`id` / `name` VARCHAR(255) / `owner_id` FK→`users.id` / `created_at` / `updated_at`
- `organization_members`：`organization_id` + `user_id` + `role_id` 三 FK，联合唯一 `uq_org_member(organization_id, user_id)`
- `roles`：预置 owner / admin / member / viewer（迁移中 `bulk_insert`）
- ORM 关系：`OrganizationMember.role` 与 `organization` 为 `lazy="joined"`，`user` 为默认懒加载（查询时用 `selectinload` 显式加载，避免 async 下的 MissingGreenlet 错误）

### 2.3 依赖注入：require_org_role

`api/deps.py` 中的 `require_org_role(*allowed_roles)` 是组织数据隔离的唯一入口：

```
org_id（由依赖从路径注入，handler 不重复声明）
  → db.get(Organization) 为空 → 404 ORGANIZATION_NOT_FOUND
  → 查 membership(org_id, user.id) 为空 → 403 NOT_ORG_MEMBER
  → membership.role.name 不命中 → 403 FORBIDDEN
  → 返回 (org, membership)
```

- 路由层定义三个上下文别名：`OrgCtx`（owner/admin/member/viewer）、`AdminCtx`（owner/admin）、`OwnerCtx`（仅 owner）
- 与 `require_role` 的差异：`require_role` 是「任意组织命中角色即通过」（供全局能力接口用），`require_org_role` 是「指定组织内命中角色」，本模块 8 个组织级端点全部走后者的别名

### 2.4 接口明细

| 接口 | 成功 | 权限（依赖别名） | 关键实现点 |
| --- | --- | --- | --- |
| `POST /organizations` `{name}` | 201 `OrganizationDetail` | 登录 | 事务：建组织 + 建 owner 成员；`db.refresh(org)` 取回 created_at |
| `GET /organizations` | 200 `OrganizationListItem[]` | 登录 | 一次取成员关系（含 org/role）+ 批量 owner 用户名与成员数 |
| `GET /organizations/{org_id}` | 200 `OrganizationDetail` | OrgCtx | my_role 来自 membership |
| `PATCH /organizations/{org_id}` `{name}` | 200 | AdminCtx | — |
| `DELETE /organizations/{org_id}` | 204 | OwnerCtx | 事务：先删全部智能体、再删成员关系、最后删组织（外键顺序，agent 模块 D8） |
| `GET /organizations/{org_id}/members` `?email=` | 200 `MemberResponse[]` | OrgCtx | `selectinload(user, role)`；email 过滤用 `user_id IN (子查询)` |
| `POST /organizations/{org_id}/members` `{email, role}` | 201 | AdminCtx | 见 2.5；role 由 `Literal["admin","member","viewer"]` 限定 |
| `PATCH /organizations/{org_id}/members/{user_id}` `{role}` | 200 | AdminCtx | role=owner 即转让（见 2.5） |
| `DELETE /organizations/{org_id}/members/me` | 204 | OrgCtx | 本人退出；owner → OWNER_CANNOT_LEAVE |
| `DELETE /organizations/{org_id}/members/{user_id}` | 204 | AdminCtx | 见 2.5 |

> 路由声明顺序约束：`/{org_id}/members/me` 必须声明在 `/{org_id}/members/{user_id}` **之前**，否则 `"me"` 会被后者按路径参数吞掉并触发 422。

### 2.5 服务层关键实现（维护时勿破坏）

- **角色修改必须赋值 relationship**：`target.role = role` / `caller.role = admin_role`，**不能**写 `target.role_id = role.id`。原因是 `target.role` 已随查询加载（lazy="joined"），仅改外键不会更新已加载的关系对象，响应会返回旧角色值（曾实测复现的 bug）。
- **server_default 取回**：MySQL 无 RETURNING，创建组织 / 添加成员后必须 `db.refresh()` 才能拿到 `created_at` / `joined_at`，否则响应时间戳为 null。
- **添加成员**：admin 授予 admin → `ROLE_NOT_ASSIGNABLE`；目标用户不存在 → 复用 `USER_NOT_FOUND`；已在组织 → 预查 409 + `IntegrityError` 兜底（并发下唯一约束兜底）。响应手工构造（新建的 membership 未预加载 `user` relationship，不能走 `_member_response`）。
- **改角色**（非转让）`_change_role`：改自己 → `SELF_ROLE_CHANGE_FORBIDDEN`；目标是 owner → `OWNER_MUST_TRANSFER`；admin 改 admin → `MEMBER_MANAGE_FORBIDDEN`；admin 授予 admin → `ROLE_NOT_ASSIGNABLE`。
- **转让** `_transfer`：仅 owner（否则 `OWNER_REQUIRED`）；不能转让给自己（`SELF_ROLE_CHANGE_FORBIDDEN`）；目标已是 owner → `ROLE_NOT_ASSIGNABLE`。事务内三处同步：目标升 owner、调用者降 admin、`organizations.owner_id` 更新（D4/D5 落点）。
- **移除** `remove_member`：目标是 owner → 自己 `OWNER_CANNOT_LEAVE`、他人 `OWNER_CANNOT_BE_REMOVED`；admin 移除 admin → `MEMBER_MANAGE_FORBIDDEN`。
- **email 过滤**：`user_id IN (select users.id where email like %xx%)` 子查询，不显式 join `users`——避免与 `selectinload(OrganizationMember.user)` 产生加载冲突。
- 创建 / 转让 / 解散均为单事务（沿用 `session.commit()` 模式），不做部分提交。

### 2.6 测试体系

- 位置：`backend/tests/test_organization.py`，沿用 auth 的 conftest 模式（测试库自动建库迁移、`dependency_overrides`、每用例清空业务表）
- 23 个用例覆盖：创建与校验（422）、组织列表/详情/me 联动、组织不存在 404、非成员 403、改名权限、添加成员（成功/未知用户 404/重复 409/非法角色 422）、member 越权 403、admin 授予 admin 403、邮箱过滤、改角色与 admin 管理边界、自己改自己 403、转让（成功 + owner_id 同步 + 旧 owner 降 admin）、转让拒绝矩阵（member 403 / admin OWNER_REQUIRED / 非成员 404 / 转让给自己 403）、移除（owner 保护 / admin 边界 / 重复移除 404）、退出、owner 不能退出、解散（越权 403 + 双方列表清空）
- 全量回归：`pytest`（当前 39 passed，含 auth 16 例）

## 3. 前端实现

### 3.1 目录结构与依赖方向

```
frontend/src/
├─ api/organizations.ts              # organizationApi（api/index.ts 追加导出）
├─ types/organization.ts             # OrgRole / AssignableRole / 各请求响应类型（index.ts 追加导出）
├─ constants/routes.ts               # 追加 ROUTE_PATHS 与 orgMembersPath / orgSettingsPath 工具
├─ constants/org-roles.ts            # ORG_ROLE_LABELS 中文文案 + ASSIGNABLE_ROLES
├─ stores/organization.ts            # currentOrgId（zustand persist）
├─ hooks/useMyOrganizations.ts       # queryKey ['orgs','list']
├─ hooks/useOrg.ts                   # queryKey ['org', orgId]
├─ hooks/useOrgMembers.ts            # queryKey ['org', orgId, 'members', email]
├─ components/layout/AppLayout.tsx   # 侧边栏骨架 + Outlet
├─ components/layout/OrgSwitcher.tsx # 组织切换下拉 + 回落逻辑
└─ pages/organizations/{List,Members,Settings}.tsx
```

依赖方向不变：`pages → hooks/stores/api/components → utils/constants/types`，不可反向。`pages/Home.tsx` 改造为概览页，`router/index.tsx` 内嵌 AppLayout，`main.tsx` 的 401 全局回调追加清空组织上下文。

### 3.2 状态与数据流

- `stores/organization.ts`：仅存 `currentOrgId: number | null`，`persist` 到 localStorage（key `agenthub.current_org_id`，与 token 前缀一致、内容独立）。**URL 参数是详情页的唯一事实来源**（orgId 取自 `useParams`），store 只服务组织切换器与侧边栏导航可见性。
- 登出与 401 刷新失败时，与 `clearTokens` / `queryClient.clear()` 一并执行 `setCurrentOrg(null)`（`AppLayout.tsx` 与 `main.tsx` 两处）。
- Query key 约定：`['orgs','list']`、`['org', orgId]`、`['org', orgId, 'members', email]`。
- 缓存联动（invalidate）：创建/退出/解散/转让 → `['orgs','list']` 与 `['auth','me']`；成员增删改 → 成员 key + `['org', orgId]`（member_count）；转让 → 额外 `['auth','me']`（自己角色已变）。

### 3.3 路由与布局

```
RequireAuth
└─ AppLayout（components/layout/AppLayout.tsx）
   ├─ /                        Home 概览页
   ├─ /organizations           List 我的组织
   ├─ /organizations/:orgId/members   Members 成员管理
   └─ /organizations/:orgId/settings  Settings 组织设置
```

- 侧边栏：Logo、组织切换器、导航（概览 / 我的组织 / 组织设置 / 成员管理）、底部用户信息与退出。无组织时「组织设置 / 成员管理」置灰并引导创建。
- `OrgSwitcher` 回落 effect：组织列表到达后，若 `currentOrgId` 已不在列表中（被解散/退出）则回落第一个组织；列表为空则置 null。切换组织时若停留在 `/:orgId/*` 详情页，自动 navigate 到新组织的同路径页面。

### 3.4 页面交互要点

| 页面 | 交互 |
| --- | --- |
| Home 概览 | 当前组织卡片（名称/拥有者/成员数/我的角色）+ 快捷入口；无组织时引导创建 |
| List | 组织卡片网格（角色徽章）+ 「创建组织」表单卡片；创建成功 → 切换 currentOrgId → 跳成员管理页 |
| Members | 搜索框（email 受控输入，变化即重新查询）；「添加成员」内联表单（RHF+zod）；行内角色下拉即时 PATCH；操作列按权限渲染「移除 / 退出组织」（`window.confirm` 确认） |
| Settings | 基本信息卡 + 改名表单（owner/admin 可见）；危险区（仅 owner）：转让（成员下拉 + 确认）、解散（输入组织名匹配才可提交） |

- 前端角色可见性由两个纯函数收敛（`pages/organizations/Members.tsx`）：`canAssignRole`（目标非自己、非 owner；admin 不能管理 admin）与 `canRemove`（目标非 owner；admin 不可移除 admin），与后端权限矩阵保持一致（后端为准）。
- 表单校验沿用 RHF + zod（组织名 1–100、邮箱格式），与后端 `schemas/organization.py` 同步；错误文案透传后端中文 message（`errorMessage()` 兜底网络异常）。
- 添加成员的角色选项：`ASSIGNABLE_ROLES = ['admin','member','viewer']`（不含 owner）；行内角色下拉选项按调用者角色收敛（owner 见三种，admin 见 member/viewer 两种）。

## 4. 关键流程时序

**4.1 创建组织**

1. List 页表单校验 → `POST /organizations`
2. 后端事务：建组织（owner_id=我）+ 建 owner 成员 → `db.refresh` → commit
3. 前端 invalidate `['orgs','list']` + `['auth','me']` → `setCurrentOrg(newId)` → 跳 `/organizations/:newId/members`

**4.2 添加成员**

1. owner/admin 输入邮箱 + 角色 → `POST /organizations/{id}/members`
2. 后端：admin 授予 admin 拒绝 → 查目标用户（无则 404）→ 查已成员（有则 409）→ 插入 + 唯一约束兜底
3. 前端 invalidate 成员 + 组织详情（member_count）

**4.3 修改成员角色（普通）**

1. Members 行内下拉 → `PATCH /organizations/{id}/members/{uid}`
2. 后端 `_change_role` 权限判定（自己/owner 目标/admin 边界）→ 赋值 `target.role` → commit
3. 前端刷新成员 + 组织详情 + 组织列表

**4.4 owner 转让**

1. Settings 选择目标成员 → 确认 → `PATCH .../members/{uid}` `{role:"owner"}`
2. 后端 `_transfer`：owner 校验 → 目标升 owner、调用者降 admin、`organization.owner_id` 同步 → commit
3. 前端 invalidate `['auth','me']`（自己角色已变）+ 成员 + 组织详情 + 组织列表，清空转让选择

**4.5 移除成员 / 本人退出**

1. Members 操作列「移除」→ `DELETE .../members/{uid}`；本人行「退出组织」→ `DELETE .../members/me`
2. 后端：owner 目标受保护（OWNER_CANNOT_BE_REMOVED / OWNER_CANNOT_LEAVE）；admin 边界校验 → 删除 → commit
3. 退出后若离开的是 currentOrgId 对应组织，OrgSwitcher 的回落 effect 自动修正（或清空）

**4.6 解散组织**

1. Settings 输入组织名匹配 → 确认 → `DELETE /organizations/{id}`
2. 后端：先删该组织全部智能体（agent 模块 D8）→ 再删成员关系 → 最后删组织 → commit
3. 前端 `setCurrentOrg(null)` → invalidate `['orgs','list']` + `['auth','me']` + removeQueries `['org', orgId]` → 跳 `/organizations`

**4.7 组织切换（前端）**

1. OrgSwitcher 下拉选择 → `setCurrentOrg(id)`
2. 若当前在 `/organizations/:orgId/*` → navigate 到新组织同路径；否则仅更新切换器与侧边栏导航
3. 若列表变化导致 currentOrgId 失效 → 回落第一个组织 / 置 null

## 5. 错误码对照表

| 后端 code | HTTP | 触发场景 | 前端展示 |
| --- | --- | --- | --- |
| `ORGANIZATION_NOT_FOUND` | 404 | 组织不存在（含解散后访问） | 后端 message（组织不存在） |
| `NOT_ORG_MEMBER` | 403 | 当前用户不是该组织成员（数据隔离） | 后端 message |
| `ALREADY_MEMBER` | 409 | 添加的邮箱已在组织中（预查 + 并发唯一约束兜底） | 后端 message（该用户已在组织中） |
| `ORG_MEMBER_NOT_FOUND` | 404 | 修改/移除的目标不是组织成员 | 后端 message |
| `OWNER_REQUIRED` | 403 | 非 owner 发起转让（admin 已过依赖层） | 后端 message |
| `OWNER_CANNOT_LEAVE` | 403 | owner 退出 / 移除自己 | 后端 message |
| `OWNER_CANNOT_BE_REMOVED` | 403 | 移除目标是 owner | 后端 message |
| `OWNER_MUST_TRANSFER` | 403 | 想改 owner 成员的角色（非转让路径） | 后端 message |
| `ROLE_NOT_ASSIGNABLE` | 403 | admin 授予/提升 admin；转让给已是 owner 的成员 | 后端 message |
| `MEMBER_MANAGE_FORBIDDEN` | 403 | admin 修改/移除 admin | 后端 message |
| `SELF_ROLE_CHANGE_FORBIDDEN` | 403 | 修改自己的角色（转让给自己除外） | 后端 message |
| `ROLE_NOT_FOUND` | 500 | roles 预置数据缺失（数据异常，正常流程不发生） | 后端 message |
| 复用 `USER_NOT_FOUND` | 404 | 添加成员的邮箱未注册 | 后端 message（用户不存在） |
| 复用 `FORBIDDEN` | 403 | `require_org_role` 角色不命中（member/viewer 越权） | 后端 message |
| （非业务错误） | — | 网络中断、超时等 axios 错误 | `errorMessage()` 兜底「网络异常，请稍后重试」 |

响应体格式统一为 `{code, message, detail}`（`main.py` 全局异常处理器输出）；`message` 即前端直接展示文案。

## 6. 维护约定与约束

以下约定在修改前必须了解设计意图，避免引入回退：

1. **`require_org_role` 是组织数据隔离的唯一入口**：新增组织域接口必须使用 OrgCtx/AdminCtx/OwnerCtx 别名，禁止在 handler/service 内自行查 membership 判权（否则出现双重查询与判定不一致）
2. **owner 强一致（D5）**：任何涉及 owner 的变更（当前仅转让）必须同一事务内同步「成员角色」与 `organizations.owner_id` 两处
3. **路由声明顺序**：`/{org_id}/members/me` 必须保持在 `/{org_id}/members/{user_id}` 之前，调整端点时勿颠倒
4. **角色修改赋值 relationship**：改角色一律 `target.role = role`，禁止写 `role_id`（已加载的 relationship 不会随外键更新，响应会拿到旧角色）
5. **新对象取回 server_default**：创建组织/添加成员后必须 `db.refresh`，否则 created_at/joined_at 为 null
6. **添加成员不可分配 owner（D4 配套）**：owner 只能通过转让变更；`MemberAddRequest.role` 由 `Literal["admin","member","viewer"]` 限定（422），维护时勿放开
7. **Query key 联动是刻意设计**：组织变更必须按 3.2 的联动表同步 invalidate（尤其 `['auth','me']`，它承载 me.organizations 与我的角色），漏刷会导致侧边栏与角色可见性陈旧
8. **前端角色可见性与后端同步维护**：`canAssignRole` / `canRemove` 与权限矩阵一一对应；改矩阵时两处同改，后端为准
9. **若未来支持邀请未注册用户（推翻 D1）**：需新增 invites 表并新建 Alembic 迁移，不修改已执行的 `20260918_0001`
10. **测试沿用 conftest 模式**：new 用例复用测试库准备与清理机制；新增错误码时 message 保持中文（前端透传路径）