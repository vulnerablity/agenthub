// hooks/useExecutions.ts
// 执行监控查询 hooks：分页/筛选列表 + 执行详情（组织隔离经请求头自动携带）
import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { executionApi } from '@/api'
import type { ExecutionListParams } from '@/types'

export const executionsQueryKey = (orgId: number, params: ExecutionListParams) =>
  ['org', orgId, 'executions', params] as const

export function useExecutions(
  orgId: number | null,
  params: ExecutionListParams,
  enabled = true,
) {
  return useQuery({
    queryKey: executionsQueryKey(orgId ?? 0, params),
    queryFn: async () => (await executionApi.list(params)).data,
    enabled: enabled && orgId != null,
    // 翻页/切筛选时保留上一页数据，避免表格闪烁
    placeholderData: keepPreviousData,
    retry: false,
  })
}

export function useExecution(
  orgId: number | null,
  executionId: string | null,
  enabled = true,
) {
  return useQuery({
    queryKey: ['org', orgId ?? 0, 'execution', executionId ?? ''],
    queryFn: async () => (await executionApi.get(executionId!)).data,
    enabled: enabled && orgId != null && executionId != null && executionId !== '',
    retry: false,
  })
}