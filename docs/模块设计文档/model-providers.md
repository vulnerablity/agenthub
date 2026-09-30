# model-providers.md — 多供应商多模型管理（一期）

目标：同一组织内可并存多个 LLM 供应商（DeepSeek / 智谱 / 豆包 / Ollama / 自建网关），
Agent 版本按「供应商 + 模型」路由调用；能力矩阵驱动参数适配；全局 LLM_API_BASE 保留为默认回落。

> 修订 v1.2：复核了本地迁移 revision 图与依赖；本地环境缺少 Alembic Python 包，`alembic heads` 未能运行，
> 因此 0008 仅可确认是版本文件图中的最新 revision，执行迁移前仍须在具备项目依赖的环境运行 `alembic heads`。
> 修正密钥轮换流程，并将现有 LLMClient 行为与本期拟改造目标区分表述。
>
> 修订 v1.1：按评审意见补定模型选择服务端规则、无供应商时的参数行为（经核实现状恒发 stream_options）、
> SSRF 残余风险与部署建议、删除/创建并发语义（IntegrityError 统一映射）、api_key 三态语义、
> test-connection 契约拆分、加密密钥生命周期（已核实 cryptography 为既有依赖）。

## 1. 决策记录

| # | 决策 |
| --- | --- |
| D1 | 两张表：`model_providers`（平台凭证）/ `provider_models`（模型清单 + 能力矩阵）；均为组织内资源，挂顶层 `/model-providers`，经 `X-Organization-Id` + `require_header_org_role` 隔离 |
| D2 | 路由真源是 `agent_versions.provider_id`（新增，可空 FK）；**默认供应商不落库**——`provider_id IS NULL` 时 LLMClient 回落全局 `LLM_API_BASE / LLM_API_KEY`（旧数据零迁移即兼容） |
| D3 | 原 `model_provider` String 列**保留但降级为展示快照**（建版本时写入供应商 name，之后不随供应商改名回写）；不做 String→FK 硬改；`model_name` 与 `provider_models` 保持**弱引用**（不 FK），支撑自定义模型兜底。用量统计（`_record_usage`）继续读快照列，**统计口径 = 版本创建时的供应商名，不是当前路由来源**；当前路由来源可由 `provider_id` join 得出，二者语义在 API 文档中注明 |
| D4 | 能力矩阵 `capabilities` JSON，键：`tool_call` / `reasoning` / `stream_usage`。**两档解析**：① `provider_id IS NULL` → **不查能力矩阵**，`_resolve_provider` 返回 caps=None，chat 侧所有参数与现状完全一致（经核实 llm.py 现状恒发 `stream_options`，等价于 `stream_usage=True` 默认，老路径逐字节不变）；② `provider_id` 非空 → 按 `(provider_id, model_name)` 查 enabled 行，命中取该行 capabilities，未命中（自定义模型）取默认 `{tool_call: true, reasoning: false, stream_usage: true}`。**一期实际消费 `tool_call` 与 `stream_usage`**；`reasoning` 仅展示与预留 |
| D5 | api_key 用 Fernet 对称加密（`utils/crypto.py`）；DB 只存密文，API 只回掩码；解密失败 → 对话 502 `MODEL_PROVIDER_KEY_INVALID`。**api_key 三态语义**（PUT/POST 通用）：字段缺省 = 保留原值；非空字符串 = 替换（重新加密）；空串 = 显式清空（置 NULL），仅允许 `provider_type` 属于免密集合（`ollama` 等本地服务），必密类型清空 → 422 `MODEL_PROVIDER_FIELD_REQUIRED`。加密密钥生命周期见 §4.1 |
| D6 | base_url 校验：默认仅 https 且解析结果全为公网 IP；`ALLOW_PRIVATE_PROVIDER_URL=true` 放行 http/内网——**这是部署级全局开关**（单实例自建/内网部署专用），不是租户级选项，生产公网部署必须保持 false。create / update / test-connection 三处共用同一校验；对话期出站请求复用保存时已校验的 URL，不做二次校验。**残余风险（DNS rebinding TOCTOU）一期明确接受**，缓解措施写入部署文档：限制 backend 容器出站目标（Docker network egress / 安全组白名单）；二期评估 pin-IP 连接或受控出站代理 |
| D7 | 删除供应商：应用层引用计数预检 → 409 `MODEL_PROVIDER_IN_USE`；删除与「创建引用该供应商的版本」**均在事务内**，并统一捕获 IntegrityError：删除撞 FK(RESTRICT) → 409 `MODEL_PROVIDER_IN_USE`；版本创建撞 FK → 404 `MODEL_PROVIDER_NOT_FOUND`（并发删除窗口）。删除模型行**不**校验（弱引用，chat 回落默认能力） |
| D8 | 预置目录 + 自定义兜底：`services/model_catalog.py` 内置常见平台目录；**仅在创建供应商时**按 `provider_type` 匹配一次性导入（幂等，只增不改不删）；后续目录更新**不会**自动改写管理员已维护的模型行与能力设置。目录同时定义 `REQUIRES_API_KEY` 集合（ollama=False，其余默认 True） |
| D9 | `stream_options` 参数化（`stream_usage` 入参），不支持的上游（如 Ollama 旧版）不传该字段——一期必做。参数默认值 True 与现状硬编码行为一致（llm.py L38-42，已核实） |
| D10 | 写操作 owner/admin，读全组织成员（Agent 表单需要）；错误码沿用 `AGENT_*` 风格 |
| D11 | 组织解散顺序：agents → model_providers → knowledge bases → members → organization。**FK 链保证顺序可行**：agent_versions.agent_id 是 ON DELETE CASCADE，删 agents 时版本行级联清除 → provider 引用计数归零 → 删 model_providers 不触发 RESTRICT → org FK CASCADE 收尾。四步在同一事务内执行 |
| D12 | **版本创建的模型选择服务端规则**（`provider_id` 非空时）：① 校验 provider 组织归属（非本组织 → 404 防泄漏）；② `(provider_id, model_name)` 命中**禁用**行 → 422 `MODEL_PROVIDER_MODEL_DISABLED`；③ 未命中任何行 → 放行（自定义模型），能力按 D4 默认值；④ `provider_id IS NULL` → 不做模型校验（走全局配置，现状行为）。**不校验「模型属于其他供应商」**：model_key 命名空间按供应商隔离，同名不构成错误 |
| D13 | **test-connection 契约**：`model_key` 可选，两种模式——缺省 → `GET {base_url}/models`（测连通 + 鉴权，OpenAI 兼容网关与 Ollama 均支持）；提供 → `POST {base_url}/chat/completions`（`max_tokens=1`）。缺少必填输入（必密类型无 key）→ 本地 422，不发请求。返回 `{ok, latency_ms, error_type?}`，error_type 枚举与映射见 §6 |
| D14 | `ENCRYPTION_KEY` 校验：未设置 → startup 打 WARN（允许启动，建供应商时才阻断）；已设置但 Fernet 格式非法 → **startup 硬失败**（静默坏密钥比拒绝启动更危险）。解密失败的供应商允许继续「更新（重填 key）/ 停用 / 删除」，仅对话路径 502 |

## 2. 数据层

### 2.1 表结构（DDL）

```sql
CREATE TABLE model_providers (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  org_id BIGINT NOT NULL,
  name VARCHAR(100) NOT NULL,
  provider_type VARCHAR(30) NOT NULL DEFAULT 'custom',  -- deepseek/zhipu/doubao/ollama/openai/custom，目录匹配键
  base_url VARCHAR(500) NOT NULL,
  api_key_encrypted TEXT NULL,                           -- Fernet 密文；免密类型（ollama）可空
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  created_by BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_model_providers_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_model_providers_creator FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT uq_model_providers_org_name UNIQUE (org_id, name)
);

CREATE TABLE provider_models (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  provider_id BIGINT NOT NULL,
  model_key VARCHAR(100) NOT NULL,      -- 精确标识：deepseek-chat / ep-2024xxxx / glm-4-flash
  display_name VARCHAR(100) NOT NULL,
  capabilities JSON NULL,               -- D4；JSON 列与 agent_versions.config_json 同类型（项目已在 MySQL 8 使用）
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_provider_models_provider FOREIGN KEY (provider_id)
    REFERENCES model_providers(id) ON DELETE CASCADE,
  CONSTRAINT uq_provider_models_key UNIQUE (provider_id, model_key)
);

ALTER TABLE agent_versions
  ADD COLUMN provider_id BIGINT NULL,
  ADD CONSTRAINT fk_agent_versions_provider FOREIGN KEY (provider_id)
    REFERENCES model_providers(id) ON DELETE RESTRICT;
CREATE INDEX ix_agent_versions_provider_id ON agent_versions (provider_id);
```

### 2.2 模型文件落点

- `models/model_provider.py`：`ModelProvider`
- `models/provider_model.py`：`ProviderModel`（capabilities JSON 列，读写直接 dict）
- 注意：遵循既有约定**不加 `updated_at` onupdate**（MissingGreenlet 教训），更新后 `db.refresh`

## 3. 迁移（0009）

`alembic/versions/20260929_0009_create_model_provider_tables.py`

- `revision = "20260929_0009"`，`down_revision = "20260929_0008"`。本地版本文件图显示 0008（down_revision=0007）是最新 revision；因当前 Python 环境缺少 Alembic，未能运行 `alembic heads`。实施前须在安装项目依赖的 backend 环境确认 head，避免并行分支或新迁移已改变版本图。
- upgrade：建两表（风格照抄 0003/0005）→ `agent_versions` 加 `provider_id` 列 + FK(RESTRICT) + 索引
- **无存量数据回填**（D2/D3：NULL = 全局回落，String 列即快照）
- downgrade：drop 索引 / FK / 列 → drop 两表
- 在 backend 目录执行 `alembic upgrade head`

## 4. 安全

### 4.1 加密（utils/crypto.py 新建）

- `encrypt_api_key(plain) -> str` / `decrypt_api_key(cipher) -> str` / `mask_api_key(plain) -> str`（`sk-****abcd`：前 3 后 4，长度不足全 `*`）
- **依赖：零新增**——`cryptography==50.0.1` 已在 requirements.txt（MySQL caching_sha2_password 依赖，已核实），直接 import Fernet
- config.py 新增：`ENCRYPTION_KEY: str = ""`，校验按 D14：未设置 → WARN；已设置但 `Fernet(key)` 抛异常 → startup 硬失败并提示重新生成
- **多实例部署约束（写入 .env.example 注释）：所有 backend 实例必须共享同一 `ENCRYPTION_KEY`**
- **密钥轮换/恢复**：更换密钥前，管理员必须通过既有密钥或其他安全渠道保有各供应商的上游 key 明文；系统 API 不提供明文导出。确认可重填后停用/安排维护窗口，再更换所有实例的 `ENCRYPTION_KEY`，逐供应商重新录入上游 key 并验证 test-connection。旧密文在新密钥下不可解密。若原密钥已丢失且没有上游 key 记录，只能逐供应商到上游控制台重置/重新获取凭证后录入。**不存在在线平滑轮换，一期不提供批量迁移工具**
- **备份要求（写入 README/.env.example 注释）：备份 `ENCRYPTION_KEY` 与供应商上游 key 的安全恢复途径；密钥丢失或更换不会恢复旧密文，需重新录入上游凭证**

### 4.2 SSRF 防护（utils/ssrf.py 新建）

- `validate_provider_url(url: str) -> None`，抛 `ProviderUrlForbidden(400)`：
  1. scheme 白名单：`https`（`ALLOW_PRIVATE_PROVIDER_URL=true` 时放行 `http`）
  2. `socket.getaddrinfo` 解析全部 IP，逐一 `ipaddress` 检查：拒绝 loopback / private / link-local(169.254/16 含云元数据) / reserved / unspecified / IPv6 ULA、link-local
  3. `ALLOW_PRIVATE_PROVIDER_URL=true` 时跳过第 2 步
- 调用点：provider create / update / test-connection；**对话期出站复用保存时校验结果，不重复解析**（明确边界，见 D6）
- **残余风险声明（D6）**：resolve 与 connect 之间的 DNS rebinding TOCTOU 一期接受。部署缓解：backend 容器出站走网络层白名单（Docker network egress / 云安全组）。二期评估：自定义 httpx transport pin 已校验 IP，或经受控出站代理转发供应商请求

## 5. 服务层

- `services/provider_service.py`：
  - CRUD + 组织隔离（跨组织一律 404 `MODEL_PROVIDER_NOT_FOUND`，沿用 KB 防泄漏模式）
  - api_key 按 D5 三态处理：缺省保留 / 非空替换（加密后落库）/ 空串清空（仅免密类型，必密类型 422）；创建时必密类型（D8 `REQUIRES_API_KEY`）缺 key → 422
  - test_connection 按 D13 两模式实现；SSRF 校验先行；超时 `PROVIDER_TEST_TIMEOUT_SECONDS=10`
  - **delete（事务内）**：引用计数预检（`agent_versions.provider_id = id`）>0 → 409；执行删除捕获 `IntegrityError` → 409 `MODEL_PROVIDER_IN_USE`（D7 并发兜底）
- `services/model_catalog.py`：`PRESET_CATALOGS: dict[str, list[dict]]`（**示意数据，以各平台官方文档为准**）+ `REQUIRES_API_KEY: set[str]` + `import_preset(provider) -> int`（**仅创建时一次性**幂等导入缺失 model_key，D8；此后目录变更不影响已建供应商）
  - `deepseek`: deepseek-chat（tool_call✓）/ deepseek-reasoner
  - `zhipu`: glm-4-flash / glm-4-plus；`doubao`: 提示用户填 ep-xxx（目录为空）；`ollama`: 各模型 `stream_usage=false`、免密
- **chat 侧能力解析（chat_service 内私有方法）**：`_resolve_provider(version)` → `(base_url|None, api_key|None, caps|None)`：
  - `version.provider_id IS NULL` → 返回 `(None, None, None)`，**不查任何表**，chat 侧参数与现状完全一致（D4 第①档）
  - `provider_id` 非空 → org 内查 provider + decrypt → 缓存于 _StreamCtx（一次解析，工具多轮复用）；provider 行被并发删除 → 版本创建撞 FK 已映射 404（D7），存续版本对话期撞删由 FK RESTRICT 保证不可达；解密失败 → 502 `MODEL_PROVIDER_KEY_INVALID`（D14：更新/停用/删除不受影响）
  - caps：按 `(provider_id, model_name)` 查 enabled 行，未命中 → D4 默认值（自定义模型）
  - provider 行存在但 `enabled=false` → 502 `MODEL_PROVIDER_DISABLED`（表单前置校验兜底）

## 6. API 契约（api/v1/model_providers.py，router.py 注册）

前缀 `/model-providers`；写 AdminCtx（owner/admin），读 OrgCtx（全成员）。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/model-providers` | 列表（含嵌套 models 数组；api_key 仅掩码） |
| POST | `/model-providers` | `{name, provider_type, base_url, api_key?, enabled?}`；必密类型缺 key → 422；按 D8 一次性导入预置模型 |
| PUT | `/model-providers/{id}` | 部分更新；api_key 三态（D5）；SSRF 校验 base_url |
| DELETE | `/model-providers/{id}` | 引用预检 + IntegrityError 兜底 → 409 `MODEL_PROVIDER_IN_USE`（D7） |
| GET | `/model-providers/catalog?provider_type=` | 返回该平台预置目录（表单预览用） |
| POST | `/model-providers/{id}/models` | `{model_key, display_name?, capabilities?}`；capabilities 键白名单 + bool 校验 → 422 `MODEL_CAPABILITY_INVALID` |
| PUT/DELETE | `/model-providers/{id}/models/{mid}` | 编辑 / 删除（删除无引用校验，D7） |
| POST | `/model-providers/test-connection` | D13：`{base_url, api_key?, model_key?}`；model_key 缺省 → GET /models，提供 → POST chat/completions(max_tokens=1)；必密类型缺 key → 422 不发请求 |

**error_type 稳定枚举**（对外契约，附固定可读消息模板；**一律不回传上游响应正文、api_key、内部网络地址**）：

| error_type | 触发 | 消息模板 |
| --- | --- | --- |
| `auth` | 上游 401/403 | API Key 无效或无权限 |
| `model_not_found` | 模型请求上游 404 | 模型标识不存在或不可用 |
| `network` | 连接失败/超时/DNS 失败 | 无法连接到供应商地址 |
| `forbidden` | SSRF 校验拒绝 | 地址不被允许 |
| `unknown` | 其余非 2xx | 供应商返回异常状态 |

错误码：`MODEL_PROVIDER_NOT_FOUND`(404) / `MODEL_PROVIDER_NAME_CONFLICT`(409) / `MODEL_PROVIDER_IN_USE`(409) / `MODEL_PROVIDER_FIELD_REQUIRED`(422) / `MODEL_PROVIDER_MODEL_DISABLED`(422) / `MODEL_CAPABILITY_INVALID`(422) / `MODEL_PROVIDER_URL_FORBIDDEN`(400) / `MODEL_PROVIDER_KEY_INVALID`(502) / `MODEL_PROVIDER_DISABLED`(502)

## 7. LLMClient 与 chat_service 改动点

### 7.1 integrations/llm.py

`chat_stream` 签名追加三个可选参数（None = 全局回落，旧调用点零改动）：

```python
async def chat_stream(self, *, messages, model, temperature=None, max_tokens=None,
                      tools=None, base_url: str | None = None,
                      api_key: str | None = None, stream_usage: bool = True):
```

- `url = (base_url or settings.LLM_API_BASE).rstrip("/") + "/chat/completions"`
- `api_key if api_key is not None else settings.LLM_API_KEY` 决定 Authorization 头（空串不带头）
- D9：`stream_usage` 为 False 时**不写入** `stream_options` 字段；默认 True 与现状硬编码一致（llm.py L38-42 已核实）

### 7.2 services/chat_service.py（改动收敛在 3 处）

1. `_StreamCtx` 增加字段：`provider_base_url / provider_api_key / caps`，构建 ctx 处调用 `_resolve_provider`
2. `_agent_loop` 内 LLM 调用点（services/chat_service.py，约 L509-512）：

```python
async for item in get_llm_client().chat_stream(
    messages=llm_message,
    model=ctx.version.model_name,
    temperature=ctx.version.temperature,
    max_tokens=ctx.version.max_tokens,
    tools=(ctx.tools or None)
          if (ctx.caps is None or ctx.caps["tool_call"]) else None,
    base_url=ctx.provider_base_url,
    api_key=ctx.provider_api_key,
    stream_usage=True if ctx.caps is None else ctx.caps["stream_usage"],
):
```

（`caps is None` 分支是全局回落兼容目标：LLMClient 仍按现状发送 `stream_options: {"include_usage": true}`。**当前仓库的 LLMClient 尚未实现文中新增参数**；实施后需以 payload 回归断言确认无 provider_id 的旧 Agent 保持相同请求行为，而不能将其描述为当前代码已支持。）

3. done/metadata：模型相关字段继续读 `version.model_name`；`_record_usage` 的 `provider=ctx.version.model_provider` 快照不变（D3 统计口径）

## 8. agent_service / schemas 改动点

- `schemas/agent.py`：VersionCreate/VersionOut 增加 `provider_id: int | None = None`；`model_provider` 改为服务端赋值（选中供应商时 = provider.name 快照；未选 = 保留客户端传入字符串，兼容旧流程/自定义）
- `services/agent_service.py`：创建版本按 **D12** 校验——provider 组织归属（非本组织 → 404 防泄漏）→ 命中禁用模型行 → 422 `MODEL_PROVIDER_MODEL_DISABLED` → 未命中放行；快照赋值逻辑与 `_normalize_rag_binding` 并列；事务内捕获供应商 FK 冲突 → 404 `MODEL_PROVIDER_NOT_FOUND`（D7 并发窗口）
- **API 文档需注明**（前端同步提示）：自定义模型（清单未命中）按默认能力处理——工具调用开、流式用量开、思考模式关
- provider 被删 → FK RESTRICT 保证版本行不受影响；无 provider_id 的旧版本行为完全不变

## 9. 前端改动清单

| 文件 | 内容 |
| --- | --- |
| `api/model-providers.ts` | 供应商 CRUD + models 子资源 + testConnection（X-Organization-Id 由 http.ts 自动携带） |
| `hooks/useModelProviders.ts` | 列表/详情数据 + 轮询不需要（无异步处理态） |
| `src/pages/model-providers/List.tsx` | 供应商卡片/表格：名称、类型、base_url、key 掩码、启停；owner/admin 显示管理按钮 |
| `src/pages/model-providers/Form.tsx` | 新建/编辑：类型选择（命中目录自动带出模型清单；免密类型隐藏 key 输入）+ base_url + api_key（编辑留空不改、清空按钮仅免密类型显示）+ 「测试连接」（可填 model_key，展示 ok/latency/error_type 中文文案） |
| `src/pages/agents/VersionForm.tsx` | **两级下拉**：供应商（首项「全局默认」= 不传 provider_id）→ 联动渲染该供应商 enabled 模型；支持下拉选择 + 手动输入兜底（datalist 风格，自定义模型直填 model_name，**旁注「未登记模型按默认能力处理」**）；提交 `provider_id + model_name` |
| `src/pages/agents/Form.tsx` | **创建智能体同样支持两级选择**（创建态，与 VersionForm 同构）：供应商下拉（首项「全局默认」= 不传 provider_id）→ 该供应商 enabled 模型下拉 / 自定义兜底；选中供应商时 Provider 输入框显示名称快照（readOnly）；提交 `provider_id + model_name`，后端 `create_agent` 按 D12 校验并绑定到自动生成的 v1（全局默认不传，兼容旧流程） |
| `types/agent.ts` | `AgentCreateRequest` 增加 `provider_id?: number \| null`（缺省 = 全局默认，与 `AgentVersionCreateRequest` 对齐）；`Form.tsx` 的 `buildCreatePayload` 据此携带绑定 |
| `src/constants/agent-options.ts` | `PROVIDER_OPTIONS` 常量标记 deprecated（仅旧版本展示回落），新增 `canManageProvider(role)` 复用 canManageAgent 判定 |
| `router/index.ts` | `MODEL_PROVIDERS` / `MODEL_PROVIDERS_NEW`（**NEW 声明在 :id 之前**，KB 路由教训）/ `MODEL_PROVIDERS_EDIT` |
| `types/model_provider.ts` | Provider / ProviderModel / Capabilities 类型 |

## 10. 配置项（.env.example 追加）

```env
# 供应商 api_key 加密密钥（Fernet）。丢失将导致已存 key 不可解密，请备份！
# 生成：python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
# 多实例部署：所有 backend 实例必须使用同一 ENCRYPTION_KEY
# 轮换：无在线平滑轮换，换 key 后需逐供应商重填 api_key（流程见 model-providers.md §4.1）
ENCRYPTION_KEY=
# 允许 http/内网供应商地址——部署级全局开关，仅限自建/内网部署场景，生产公网部署保持 false
ALLOW_PRIVATE_PROVIDER_URL=false
# 测试连接超时（秒）
PROVIDER_TEST_TIMEOUT_SECONDS=10
```

（依赖：无新增，`cryptography==50.0.1` 已存在于 requirements.txt）

## 11. 测试要点

1. 迁移：存量库升级后 agent_versions.provider_id 全 NULL，旧 Agent 对话走全局配置正常（回归）；实施前 `alembic heads` 复核 0008
2. 加密：库内为密文；列表/详情仅掩码；ENCRYPTION_KEY 未设置建供应商报错、格式非法 startup 硬失败、错误 key 解密 → 对话 502 且该供应商仍可更新/删除
3. api_key 三态：PUT 缺省不变 / 非空替换 / 空串清空（ollama 允许、deepseek 422）
4. 隔离：跨组织 provider_id → 404（列表、版本创建两处）；非 owner/admin 写操作 403
5. 删除与并发：被版本引用 → 409 且 DB 行仍在；无引用可删且 models 级联清理；并发窗口 IntegrityError → 409（删除）/ 404（版本创建）
6. 版本创建模型校验（D12）：禁用模型 422；未登记模型放行；provider_id NULL 不校验
7. 能力适配：monkeypatch LLMClient 断言 payload——caps=None 时与现状逐字节一致（含 stream_options）；tool_call=false 不含 tools/tool_choice；stream_usage=false 不含 stream_options
8. SSRF：`http://127.0.0.1` / `http://169.254.169.254` / `http://192.168.1.1` 被拒 400；ALLOW_PRIVATE_PROVIDER_URL=true 放行
9. test-connection：无 model_key → GET /models 路径；有 model_key → POST chat/completions；mock 上游 401 / 404 / 超时 → error_type 映射正确且响应不含上游正文

## 12. 一期验收

同一组织创建 DeepSeek 与智谱两个供应商（各配 key 与模型），两个 Agent 分别经各自供应商流式对话正常；第三个老 Agent（无 provider_id）经全局 LLM_API_BASE 正常对话；所有 api_key 在 DB 为密文、接口仅掩码；选错 key 时「测试连接」给出可读错误（error_type 中文文案）。

## 13. 二期 / 三期（非本期范围）

二期：reasoning 参数真实接入（思考模式 UI 开关 + 请求参数适配，依赖平台参数名差异调研）、按能力隐藏不可用功能、SSRF pin-IP 连接或受控出站代理。三期：默认供应商标识、主备模型自动降级、用量按供应商聚合报表。
