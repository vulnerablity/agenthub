// api/model-providers.ts
// 模型供应商接口封装：与后端 /api/v1/model-providers 对齐（model-providers.md §6，组织隔离经请求头自动携带）
import { http } from '@/utils/http'
import type {
  ModelProviderCreateRequest,
  ModelProviderDetail,
  ModelProviderUpdateRequest,
  ProviderCatalogResponse,
  ProviderModelCreateRequest,
  ProviderModelItem,
  ProviderModelUpdateRequest,
  TestConnectionRequest,
  TestConnectionResponse,
} from '@/types'

export const modelProvidersApi = {
  // ---------- 供应商 CRUD ----------
  create(data: ModelProviderCreateRequest) {
    return http.post<ModelProviderDetail>('/model-providers', data)
  },
  list() {
    return http.get<ModelProviderDetail[]>('/model-providers')
  },
  /** 预置目录预览（D8，表单用）：各 provider_type 模型清单 + 必密类型集合 */
  getCatalog() {
    return http.get<ProviderCatalogResponse>('/model-providers/catalog')
  },
  get(providerId: number) {
    return http.get<ModelProviderDetail>(`/model-providers/${providerId}`)
  },
  /** 部分更新：api_key 三态（D5）——缺省保留原值 / 空串清空（仅免密类型）/ 非空替换 */
  update(providerId: number, data: ModelProviderUpdateRequest) {
    return http.patch<ModelProviderDetail>(`/model-providers/${providerId}`, data)
  },
  /** 被智能体版本引用时返回 409 MODEL_PROVIDER_IN_USE */
  remove(providerId: number) {
    return http.delete(`/model-providers/${providerId}`)
  },

  // ---------- 测试连接（D13 两模式） ----------
  testConnection(data: TestConnectionRequest) {
    return http.post<TestConnectionResponse>('/model-providers/test-connection', data)
  },

  // ---------- 模型清单（model_key 创建后不可变） ----------
  addModel(providerId: number, data: ProviderModelCreateRequest) {
    return http.post<ProviderModelItem>(`/model-providers/${providerId}/models`, data)
  },
  updateModel(providerId: number, modelId: number, data: ProviderModelUpdateRequest) {
    return http.patch<ProviderModelItem>(
      `/model-providers/${providerId}/models/${modelId}`,
      data,
    )
  },
  removeModel(providerId: number, modelId: number) {
    return http.delete(`/model-providers/${providerId}/models/${modelId}`)
  },
}
