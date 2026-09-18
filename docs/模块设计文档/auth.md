# Auth 模块设计文档

> 本文档描述 Auth 模块的**当前实际实现**，以代码为准，供后期维护与迭代参考。
> 范围：后端 4 个认证接口与前端登录/注册/退出界面。组织管理等相邻模块不在本文范围（仅涉及本模块所建的数据表）。

## 1. 模块概述

功能清单：

- 用户注册（邮箱 + 用户名 + 密码）
- 用户登录（返回 Access / Refresh 双 Token）
- Token 刷新（Refresh 换发新双 Token，旧 Refresh 作废）
- 获取当前用户（基本信息 + 所属组织 + 角色）

需求来源：需求文档 3.1 用户认证模块 + 安全要求（密码禁止明文、JWT 认证、RBAC）。

前后端对应关系：

| 功能 | 后端接口 | 前端实现 |
| --- | --- | --- |
| 注册 | `POST /api/v1/auth/register` | `pages/auth/Register.tsx` → `api/auth.ts` |
| 登录 | `POST /api/v1/auth/login` | `pages/auth/Login.tsx` → `api/auth.ts` |
| 刷新 | `POST /api/v1/auth/refresh` | `utils/http.ts` 拦截器自动触发（及 `api/auth.ts`） |
| 当前用户 | `GET /api/v1/auth/me` | `hooks/useMe.ts` → `pages/Home.tsx` |

## 2. 后端实现

### 2.1 目录结构与分层

```
backend/app/
├─ main.py                     # 装配：CORS、统一异常处理、挂载 /api/v1 路由
├─ api/
│  ├─ deps.py                  # get_db / get_current_user / require_role 依赖
│  └─ v1/
│     ├─ router.py             # api_router 聚合各模块路由
│     └─ auth.py               # register / login / refresh / me 四端点
├─ core/
│  ├─ config.py                # pydantic-settings 读取 backend/.env
│  ├─ security.py              # argon2 密码哈希 + JWT 签发/解析
│  └─ exceptions.py            # AppError 业务异常体系
├─ models/                     # User / Role / Organization / OrganizationMember
├─ schemas/auth.py             # Pydantic 请求/响应模型
├─ repositories/user_repo.py   # users 表数据访问
├─ services/auth_service.py    # 注册/登录/刷新/当前用户业务逻辑
└─ db/
   ├─ session.py               # asyncmy 异步引擎 + 会话工厂
   └─ redis.py                 # refresh token jti 吊销（含降级）
```

分层链路：`router → AuthService → UserRepository → SQLAlchemy`，路由层不写业务与 SQL。

### 2.2 数据模型

| 表 | 关键字段 | 说明 |
| --- | --- | --- |
| `users` | `id` BIGINT 自增主键；`email` VARCHAR(255) 唯一（索引 `ix_users_email`）；`username` VARCHAR(100)；`password_hash` VARCHAR(255)；`avatar_url` VARCHAR(500) 可空；`status` VARCHAR(20) 默认 `active`；`created_at` / `updated_at` | 对应需求 4.1 |
| `roles` | `id`；`name` VARCHAR(50) 唯一；`description` VARCHAR(255) | 预置 owner/admin/member/viewer |
| `organizations` | `id`；`name` VARCHAR(255)；`owner_id` FK → `users.id`；时间戳 | 对应需求 4.2 |
| `organization_members` | `id`；`organization_id` / `user_id` / `role_id` 三个 FK；`created_at`；联合唯一 `uq_org_member(organization_id, user_id)` | 对应需求 4.3 |

ORM 关系：`User.memberships` ↔ `OrganizationMember.user`；`OrganizationMember.organization`、`OrganizationMember.role` 均为 `lazy="joined"`（`/me` 查询用 `selectinload` 一并加载，避免 N+1）。

数据库迁移：

- `backend/alembic/versions/20260918_0001_create_auth_tables.py`：建 4 表 + `bulk_insert` 预置四种角色
- `alembic.ini` 中 `sqlalchemy.url` 留空；`env.py` 地址解析顺序为 **ini/命令行传入 > `app.core.config` 的 .env**（后者是测试库覆盖的入口）

### 2.3 密码安全

- 使用 `pwdlib` 的 `PasswordHash.recommended()`（底层 argon2），核心函数在 `core/security.py`：`hash_password` / `verify_password`
- 密码只以哈希入库（`password_hash`），任何环节不落明文
- 登录失败统一返回「邮箱或密码错误」（`INVALID_CREDENTIALS`），不区分账号是否存在，防枚举

### 2.4 Token 机制

| Token | 形态 | claims | 有效期 |
| --- | --- | --- | --- |
| Access | 无状态 JWT（HS256） | `sub`（用户 id 字符串）、`type:"access"`、`username`、`iat`、`exp` | 30 分钟（`ACCESS_TOKEN_EXPIRE_MINUTES`） |
| Refresh | JWT 携带 jti | `sub`、`type:"refresh"`、`jti`、`iat`、`exp` | 7 天（`REFRESH_TOKEN_EXPIRE_DAYS`） |

- Refresh 的 `jti` 写入 Redis，key 为 `refresh:jti:{jti}`，TTL 与 refresh 有效期一致；换发时先 `consume`（删除）—— 旧 Refresh **立即作废**（token 旋转）
- **Redis 降级设计**（`db/redis.py`）：Redis 不可用时 `store` 静默跳过、`consume` 直接放行。即开发环境无 Redis 时登录/刷新仍可用，仅失去吊销能力；生产环境需保证 Redis 可用
- 密钥要求：`JWT_SECRET_KEY` ≥ 32 字节（HS256），算法固定 `HS256`
- 类型校验：`decode_token(token, expected_type)` 中 access/refresh 互不通用，类型不匹配抛 `TOKEN_INVALID`

### 2.5 接口明细

| 接口 | 成功响应 | 错误 |
| --- | --- | --- |
| `POST /api/v1/auth/register` | 201 `{id, email}` | 409 `EMAIL_ALREADY_REGISTERED`（预查 + `IntegrityError` 兜底）；422 校验失败 |
| `POST /api/v1/auth/login` | 200 `{access_token, refresh_token, token_type:"bearer", expires_in:1800}` | 401 `INVALID_CREDENTIALS`；403 `USER_INACTIVE` |
| `POST /api/v1/auth/refresh` | 200 新双 Token | 401 `TOKEN_INVALID`（签名/类型/已消费）、`TOKEN_EXPIRED`；404 `USER_NOT_FOUND`；403 `USER_INACTIVE` |
| `GET /api/v1/auth/me` | 200 `{id, email, username, avatar_url, status, created_at, organizations:[{id, name, role}]}` | 401 无/无效/过期 Token；404 / 403 |

请求校验规则（`schemas/auth.py`，前后端一致）：邮箱 `EmailStr`；用户名 1–100；密码 6–128（最短 6 位与需求示例一致）。

产品决策：**注册不自动创建组织**，新用户 `me` 返回空 `organizations` 数组属于正常态。

### 2.6 依赖注入与 RBAC

- `get_db`：基于 `async_session_factory`（`expire_on_commit=False`）的异步会话
- `get_current_user`：`HTTPBearer(auto_error=False)` → 解析 access token → 按 `sub` 查用户 → 校验 `status == "active"`
- `require_role(*roles)`：依赖工厂，统计当前用户在任意组织命中指定角色（join `roles`），不满足抛 `FORBIDDEN`。本期 auth 路由未使用，供后续 Agent/知识库等模块复用
- 类型别名：`DbSession`、`CurrentUser`（Annotated + Depends）

### 2.7 统一错误与响应格式

业务异常继承 `AppError(status_code, code, message)`，由 `main.py` 全局异常处理器统一输出：

```json
{ "code": "INVALID_CREDENTIALS", "message": "邮箱或密码错误", "detail": null }
```

错误码全集见第 5 节对照表。

### 2.8 配置项（backend/.env 关键字段）

| 字段 | 用途 |
| --- | --- |
| `API_V1_PREFIX` | 路由前缀 `/api/v1` |
| `JWT_SECRET_KEY` / `JWT_ALGORITHM` | JWT 密钥与算法 |
| `ACCESS_TOKEN_EXPIRE_MINUTES` / `REFRESH_TOKEN_EXPIRE_DAYS` | 双 Token 有效期 |
| `DATABASE_URL` | `mysql+asyncmy://` 连接串（优先；缺省时由 `MYSQL_*` 分项拼接） |
| `REDIS_URL` | refresh jti 吊销存储 |
| `CORS_ORIGINS` | 逗号分隔的跨域来源 |

`Settings` 类字段与 .env 变量一一对应，`env_file` 通过 `backend/.env` 绝对路径定位（`core/config.py` 中按文件位置推导）。

### 2.9 测试体系

- 位置：`backend/tests/`；`pytest.ini` 配置 `asyncio_mode=auto`，且 **fixture 与 test 的事件循环作用域均设为 session**（`asyncio_default_fixture_loop_scope` / `asyncio_default_test_loop_scope`）
- `conftest.py`：
  - 测试库默认 `agenthub_test`（`TEST_DATABASE_URL` 环境变量可覆盖），session 级自动建库 + 执行 Alembic 迁移
  - 测试引擎使用 **NullPool**，每个用例独立会话，用例结束自动清空业务表（保留预置 `roles`）
  - HTTP 客户端基于真实 app（`httpx.ASGITransport`），通过 `app.dependency_overrides[get_db]` 指向测试库会话
- 用例：`test_security.py`（密码哈希 2 例、JWT 签名/类型/篡改 4 例）+ `test_auth.py`（注册成功/重复/非法邮箱、登录成败、me 无 token、me 无组织断言、刷新换发与旧 token 作废、refresh 拒绝 access token）

## 3. 前端实现

### 3.1 目录结构与依赖方向

```
frontend/src/
├─ api/          auth.ts + index.ts（barrel）        # 接口层：纯接口定义
├─ types/        auth.ts、http.ts + index.ts        # 类型层：对齐后端协议
├─ utils/        token.ts、http.ts、query-client.ts # 工具层：基础设施
├─ constants/    routes.ts、error-messages.ts       # 常量层：静态数据
├─ stores/       auth.ts                            # 状态层：登录态布尔
├─ hooks/        useMe.ts                           # 组合层：当前用户查询
├─ router/       index.tsx、RequireAuth.tsx         # 路由层
├─ components/   form/TextField.tsx                 # 共享 UI
└─ pages/        auth/Login.tsx、auth/Register.tsx、Home.tsx
```

依赖方向（单向，不可反向）：

```
pages → hooks / stores / api / components → utils / constants / types
```

### 3.2 Token 持久化

`utils/token.ts` 是 **Token 的唯一读写入口**，其余代码（拦截器、守卫、store）禁止直接操作 localStorage：

- key：`agenthub.access_token`、`agenthub.refresh_token`
- API：`getAccessToken` / `getRefreshToken` / `setTokens` / `clearTokens` / `hasAccessToken`

### 3.3 HTTP 层（utils/http.ts）

- `http`：axios 实例，`baseURL = /api/v1`；请求拦截器自动附加 `Authorization: Bearer <access>`
- 响应拦截器 401 处理流程：

```
401 → 非业务接口且未重试过 → 单飞刷新 → 成功: 写回 Token 并重放原请求
                                    → 失败: 清 Token + 触发 onUnauthorized → 抛业务错误
```

关键实现点（维护时勿破坏）：

- `SKIP_REFRESH_PATHS`：`/auth/login`、`/auth/register`、`/auth/refresh` 自身 401 不进入刷新流程（防登录失败死循环）
- **单飞**：模块级 `refreshPromise` 保证并发 401 只发一次刷新请求，其余请求等待同一 Promise
- **防递归**：刷新调用使用无拦截器的裸 axios 实例，不经过 `http`
- 重放：给 config 打 `_retried` 标记后 `http.request(config)`，请求拦截器会附带新 Token
- **登出解耦**：刷新失败不直接跳转，而是调用 `main.tsx` 装配时注入的 `onUnauthorized` 回调（清 Token + 清缓存 + 置登出态），由路由守卫随状态联动跳转登录页

错误规整：`normalizeError` 把携带 `{code, message}` 的响应体构造成 `ApiError(status, code)`（`types/http.ts`），非业务错误原样抛出。

### 3.4 状态管理

- `stores/auth.ts`（Zustand）：仅存 `isAuthenticated` 布尔与 `signIn` / `signOut` 动作；初始值来自 `hasAccessToken()`。**不持有 Token 副本**，避免与拦截器双写不同步
- `hooks/useMe.ts`（TanStack Query）：queryKey `['auth','me']`，`retry: false`（401 交给拦截器），参数 `enabled` 控制触发时机
- `utils/query-client.ts`（全局 QueryClient）：`staleTime` 30s、`refetchOnWindowFocus: false`、`retry: 1`；登出时整体 `clear()`

### 3.5 路由与守卫

- `router/index.tsx`：`createBrowserRouter`；公开页 `/login`、`/register`；受保护区域由 `RequireAuth`（layout route）包裹，子路由 `/` → Home
- `RequireAuth`：未登录时 `<Navigate to="/login" state={{from: pathname+search}}>`；登录成功后 `navigate(from ?? '/', {replace:true})` 回跳
- 注册成功跳 `/login` 并携带 `state.email`，登录页据此预填邮箱
- 路径常量集中在 `constants/routes.ts`（`ROUTE_PATHS`）

### 3.6 页面交互

| 页面 | 表单校验（RHF + zod） | 交互 |
| --- | --- | --- |
| Login | 邮箱格式、密码非空 | 登录 → `setTokens` + `signIn` → 回跳；接口错误展示 `apiError`（透传后端中文 message） |
| Register | 邮箱格式、用户名 1–100、密码 6–128（与后端一致） | 成功跳登录并预填邮箱；如「该邮箱已被注册」直接展示后端 message |
| Home | — | `useMe` 展示用户名/邮箱/组织角色列表；退出登录 = `clearTokens` + `queryClient.clear()` + `signOut` + 跳登录页 |

- 错误文案来源：`ApiError.message`（后端已中文化）优先，网络类异常由 `constants/error-messages.ts` 的 `errorMessage()` 兜底为「网络异常，请稍后重试」
- 共享组件 `components/form/TextField.tsx`：标签 + 错误态 + 禁用态（React 19 `forwardRef`，供后续表单复用）

### 3.7 工程配置

- `vite.config.ts`：`@` 别名指向 `src`；dev 代理 `/api` → `http://localhost:8000`（与后端 `API_V1_PREFIX` 对应，前后端同源联调）
- `tsconfig.app.json`：`paths: {"@/*": ["./src/*"]}`（注意：无 `baseUrl`，TS 6.0 已弃用该项）
- 样式：Tailwind CSS 4（`@tailwindcss/vite` 插件），`src/index.css` 仅保留 `@import "tailwindcss"` 与最小全局样式

## 4. 关键流程时序

**4.1 注册**

1. 前端 zod 校验通过 → `POST /api/v1/auth/register`
2. 后端校验邮箱唯一（预查 + 唯一索引兜底），argon2 哈希后落库
3. 409 → 页面展示「该邮箱已被注册」；201 → 跳转登录页并携带邮箱
4. 登录页 `defaultValues` 预填邮箱

**4.2 登录**

1. 表单校验 → `POST /api/v1/auth/login`
2. 后端 verify_password + `status` 校验 → 签发双 Token（refresh jti 写 Redis）
3. 前端 `setTokens` → `signIn()` → `navigate(from ?? '/')`
4. 进入 Home 后 `useMe` 拉取用户与组织角色

**4.3 401 自动刷新**

1. 任意业务接口返回 401（access 过期/无效）
2. 拦截器判定非 `SKIP_REFRESH_PATHS` 且未重试 → 进入单飞刷新
3. `POST /auth/refresh`（裸 axios）→ 后端 consume jti 后签发新 Token
4. 成功：写回 storage → 重放原请求；失败：清 Token → `onUnauthorized` → 守卫跳登录

**4.4 退出登录**

1. Home 点击退出 → `clearTokens` + `queryClient.clear()` + `signOut()`
2. `navigate('/login')`（守卫兜底：任何页面登出态都会跳登录）

## 5. 错误码对照表

| 后端 code | HTTP | 触发场景 | 前端展示 |
| --- | --- | --- | --- |
| `EMAIL_ALREADY_REGISTERED` | 409 | 注册邮箱已存在 | 后端 message（该邮箱已被注册） |
| `INVALID_CREDENTIALS` | 401 | 登录邮箱或密码错误 | 后端 message（邮箱或密码错误） |
| `TOKEN_INVALID` | 401 | 签名无效 / token 类型不匹配 / refresh 已被消费 | 拦截器接管或后端 message |
| `TOKEN_EXPIRED` | 401 | Token 过期（refresh 过期即无法续期） | 后端 message |
| `USER_NOT_FOUND` | 404 | me / refresh 时用户不存在 | 后端 message |
| `USER_INACTIVE` | 403 | 账号被禁用 | 后端 message |
| `FORBIDDEN` | 403 | `require_role` 角色不满足（预留） | 后端 message |
| （非业务错误） | — | 网络中断、超时等 axios 错误 | `errorMessage()` 兜底「网络异常，请稍后重试」 |

响应体格式统一为 `{code, message, detail}`；`detail` 当前恒为 `null`，预留扩展。

## 6. 维护约定与约束

以下约定在修改前必须了解设计意图，避免引入回退：

1. **分层依赖单向**：`utils` 不得 import `api/stores/pages`。`http.ts` 用裸 axios 直调刷新接口正是为了不依赖 `api` 层（否则循环依赖）
2. **Token 单一数据源**：任何新代码读写 Token 必须经 `utils/token.ts`，禁止直接操作 localStorage；Zustand 只维护布尔登录态
3. **新增「自身 401 属正常业务」的接口时**，必须同步加入 `SKIP_REFRESH_PATHS`，否则会触发无意义的刷新与潜在死循环
4. **Redis 降级是有意设计**：Redis 不可用时 `consume` 放行。若未来需要强吊销语义（如强制下线），须移除降级逻辑并保证 Redis 可用性
5. **测试配置不可回退**：`pytest.ini` 的 session 级事件循环与 `NullPool` 是为规避 asyncmy 连接跨事件循环复用损坏（表现为 `Command Out of Sync` / `attribute error`）而设；新增测试沿用 conftest 的库准备与 `dependency_overrides` 模式
6. **注册不自动创建组织是产品决策**：`me` 返回空 `organizations` 属正常态，勿在 auth 模块内补建组织逻辑（归属 3.2 组织管理模块）
7. **校验规则前后端需同步**：密码 6–128、用户名 1–100、邮箱格式分处 `backend/app/schemas/auth.py` 与 `frontend/src/pages/auth/*.tsx` 两处，改动任一处须同步另一处
8. **JWT 密钥**：`JWT_SECRET_KEY` 必须 ≥ 32 字节；生产环境更换随机密钥
9. **新增错误码时**：后端 exception message 即前端展示文案，需保持中文并考虑 `errorMessage()` 的透传路径
10. **数据库结构变更**：一律新增 Alembic 迁移文件，不修改已执行的迁移；`env.py` 地址覆盖顺序（ini > .env）是测试库机制，勿改动