// hooks/useAgents.ts
// 组织智能体列表查询：name 模糊 / status 过滤变化即重新拉取（组织隔离经请求头）
import { useQuery } from '@tanstack/react-query'

import { agentApi } from '@/api'
import type { AgentStatus } from '@/types'

export interface AgentListFilter {
  name?: string
  status?: AgentStatus
}

export const agentsQueryKey = (orgId: number, filter: AgentListFilter) =>
  ['org', orgId, 'agents', filter.name ?? '', filter.status ?? ''] as const

export function useAgents(
  orgId: number | null,
  filter: AgentListFilter,
  enabled = true,
) {
  return useQuery({
    queryKey: agentsQueryKey(orgId ?? 0, filter),
    queryFn: async () => (await agentApi.list(filter)).data,
    enabled: enabled && orgId != null,
    retry: false,
  })
}