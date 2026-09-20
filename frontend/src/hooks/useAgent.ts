// hooks/useAgent.ts
// 单个智能体详情查询，orgId / agentId 来自页面 URL 参数（orgId 仅参与缓存 key，隔离走请求头）
import { useQuery } from '@tanstack/react-query'

import { agentApi } from '@/api'

export const agentQueryKey = (orgId: number, agentId: number) =>
  ['org', orgId, 'agent', agentId] as const

export function useAgent(orgId: number | null, agentId: number | null, enabled = true) {
  return useQuery({
    queryKey: agentQueryKey(orgId ?? 0, agentId ?? 0),
    queryFn: async () => (await agentApi.get(agentId!)).data,
    enabled: enabled && orgId != null && agentId != null,
    retry: false,
  })
}

/** 智能体版本列表（与详情/列表 key 互不复用，独立失效） */
export const agentVersionsQueryKey = (orgId: number, agentId: number) =>
  ['org', orgId, 'agent', agentId, 'versions'] as const

export function useAgentVersions(
  orgId: number | null,
  agentId: number | null,
  enabled = true,
) {
  return useQuery({
    queryKey: agentVersionsQueryKey(orgId ?? 0, agentId ?? 0),
    queryFn: async () => (await agentApi.listVersions(agentId!)).data,
    enabled: enabled && orgId != null && agentId != null,
    retry: false,
  })
}