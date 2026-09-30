// hooks/useModelProviders.ts
// 模型供应商查询：列表 / 详情 / 预置目录（组织隔离经请求头；读写权限矩阵后端为准）
import { useQuery } from '@tanstack/react-query'

import { modelProvidersApi } from '@/api'

export const modelProvidersQueryKey = (orgId: number) =>
  ['org', orgId, 'model-providers'] as const

export const modelProviderQueryKey = (orgId: number, providerId: number) =>
  ['org', orgId, 'model-providers', providerId] as const

export const providerCatalogQueryKey = (orgId: number) =>
  ['org', orgId, 'model-provider-catalog'] as const

/** 供应商列表（含嵌套 models）：Agent 表单两级下拉与 List 页共用（D10 全成员可读） */
export function useModelProviders(orgId: number | null, enabled = true) {
  return useQuery({
    queryKey: modelProvidersQueryKey(orgId ?? 0),
    queryFn: async () => (await modelProvidersApi.list()).data,
    enabled: enabled && orgId != null,
    retry: false,
  })
}

/** 单个供应商详情（编辑页加载） */
export function useModelProvider(
  orgId: number | null,
  providerId: number | null,
  enabled = true,
) {
  return useQuery({
    queryKey: modelProviderQueryKey(orgId ?? 0, providerId ?? 0),
    queryFn: async () => (await modelProvidersApi.get(providerId!)).data,
    enabled: enabled && orgId != null && providerId != null,
    retry: false,
  })
}

/** 预置目录（D8）：表单按 provider_type 预览模型清单与必密标记 */
export function useProviderCatalog(orgId: number | null, enabled = true) {
  return useQuery({
    queryKey: providerCatalogQueryKey(orgId ?? 0),
    queryFn: async () => (await modelProvidersApi.getCatalog()).data,
    enabled: enabled && orgId != null,
    retry: false,
  })
}
