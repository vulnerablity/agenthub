// hooks/useAgentTools.ts
// Agent 绑定工具查询与变更 hooks（需求 3.7 POST /agents/{id}/tools；加载对话时实时读取启用绑定）
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { toolApi } from '@/api'
import type { AgentToolBindRequest } from '@/types'

export const agentToolsQueryKey = (agentId: number) => ['agent', agentId, 'tools'] as const

export function useAgentTools(agentId: number | null, enabled = true) {
  return useQuery({
    queryKey: agentToolsQueryKey(agentId ?? 0),
    queryFn: async () => (await toolApi.listAgentTools(agentId!)).data,
    enabled: enabled && agentId != null,
    retry: false,
  })
}

export function useBindAgentTool(agentId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: AgentToolBindRequest) => toolApi.bindAgentTool(agentId, data),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: agentToolsQueryKey(agentId) }),
  })
}

export function useUpdateAgentTool(agentId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ toolId, data }: { toolId: number; data: Partial<AgentToolBindRequest> }) =>
      toolApi.updateAgentTool(agentId!, toolId, data),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: agentToolsQueryKey(agentId) }),
  })
}

export function useUnbindAgentTool(agentId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (toolId: number) => toolApi.unbindAgentTool(agentId, toolId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: agentToolsQueryKey(agentId) }),
  })
}