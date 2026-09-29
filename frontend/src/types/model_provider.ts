// types/model_provider.ts
// 模型供应商协议类型：与 backend/app/schemas/model_provider.py 一一对应（model-providers.md §6）
/** 能力矩阵（D4）：一期消费 tool_call 与 stream_usage，reasoning 仅展示与预留 */
export interface ProviderModelCapabilities {
  tool_call: boolean
  reasoning: boolean
  stream_usage: boolean
}

export interface ProviderModelItem {
  id: number
  model_key: string
  display_name: string
  capabilities: ProviderModelCapabilities | null
  enabled: boolean
}

/** key_status：empty=未设置（免密）、set=已设置（掩码回显）、invalid=已存密钥解密失败需重填 */
export type ModelProviderKeyStatus = 'empty' | 'set' | 'invalid'

export interface ModelProviderDetail {
  id: number
  name: string
  provider_type: string
  base_url: string
  api_key_masked: string | null
  key_status: ModelProviderKeyStatus
  enabled: boolean
  models: ProviderModelItem[]
  created_at: string
}

export interface ModelProviderCreateRequest {
  name: string
  provider_type: string
  base_url: string
  api_key?: string | null
  enabled?: boolean
}

/** api_key 三态语义（D5）：字段缺省 = 保留原值；空串 = 清空（仅免密类型）；非空 = 替换 */
export interface ModelProviderUpdateRequest {
  name?: string | null
  base_url?: string | null
  api_key?: string | null
  enabled?: boolean | null
}

export interface ProviderModelCreateRequest {
  model_key: string
  display_name?: string | null
  capabilities?: ProviderModelCapabilities | null
  enabled?: boolean
}

/** model_key 创建后不可变（版本弱引用匹配键），仅可改 display_name/capabilities/enabled */
export interface ProviderModelUpdateRequest {
  display_name?: string | null
  capabilities?: ProviderModelCapabilities | null
  enabled?: boolean | null
}

export interface TestConnectionRequest {
  base_url: string
  api_key?: string | null
  model_key?: string | null
  provider_type?: string | null
}

export type ProviderTestErrorType =
  | 'auth'
  | 'model_not_found'
  | 'network'
  | 'forbidden'
  | 'unknown'

/** 测试连接响应（D13）：失败不抛 HTTP 错误，ok=false + error_type */
export interface TestConnectionResponse {
  ok: boolean
  latency_ms: number
  error_type: ProviderTestErrorType | null
  message: string | null
}

/** 预置目录条目（PRESET_CATALOGS 值结构）：capabilities 仅写差异键，可缺省 */
export interface ProviderCatalogEntry {
  model_key: string
  display_name?: string
  capabilities?: Partial<ProviderModelCapabilities>
}

/** GET /model-providers/catalog 响应：目录清单 + 必密类型集合 */
export interface ProviderCatalogResponse {
  catalogs: Record<string, ProviderCatalogEntry[]>
  requires_api_key: string[]
}
