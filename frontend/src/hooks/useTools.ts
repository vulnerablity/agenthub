// hooks/useTools.ts
// 工具查询与变更 hooks：列表 / 详情 / 创建 / 更新 / 删除 / 测试（组织隔离经请求头）
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { toolApi } from '@/api'
import type { ToolCreateRequest, ToolTestRequest, ToolUpdateRequest } from '@/types'

export const toolsQueryKey = (orgId: number) => ['org', orgId, 'tools'] as const

export function useTools(orgId: number | null, enabled = true) {
  return useQuery({
    queryKey: toolsQueryKey(orgId ?? 0),
    queryFn: async () => (await toolApi.list()).data,
    enabled: enabled && orgId != null,
    retry: false,
  })
}

export function useTool(orgId: number | null, toolId: number | null, enabled = true) {
  return useQuery({
    queryKey: ['org', orgId ?? 0, 'tool', toolId ?? 0],
    queryFn: async () => (await toolApi.get(toolId!)).data,
    enabled: enabled && orgId != null && toolId != null,
    retry: false,
  })
}

export function useCreateTool(orgId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: ToolCreateRequest) => toolApi.create(data),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: toolsQueryKey(orgId) }),
  })
}

export function useUpdateTool(orgId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ toolId, data }: { toolId: number; data: ToolUpdateRequest }) =>
      toolApi.update(toolId, data),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: toolsQueryKey(orgId) }),
  })
}

export function useDeleteTool(orgId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (toolId: number) => toolApi.remove(toolId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: toolsQueryKey(orgId) }),
  })
}

export function useTestTool() {
  return useMutation({
    mutationFn: async ({
      toolId,
      data,
    }: {
      toolId: number
      data: ToolTestRequest
    }) => (await toolApi.test(toolId, data)).data,
  })
}