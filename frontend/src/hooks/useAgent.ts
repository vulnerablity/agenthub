// hooks/useAgent.ts
// 单个智能体详情查询，orgId / agentId 来自页面 URL 参数
import { useQuery } from '@tanstack/react-query'

import { agentApi } from '@/api'

export const agentQueryKey = (orgId: number, agentId: number) =>
  ['org', orgId, 'agent', agentId] as const

export function useAgent(orgId: number | null, agentId: number | null, enabled = true) {
  return useQuery({
    queryKey: agentQueryKey(orgId ?? 0, agentId ?? 0),
    queryFn: async () => (await agentApi.get(orgId!, agentId!)).data,
    enabled: enabled && orgId != null && agentId != null,
    retry: false,
  })
}