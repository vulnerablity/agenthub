// api/executions.ts
// 执行监控接口封装：与后端 /api/v1/executions 对齐（组织隔离经 X-Organization-Id 请求头自动携带）
import { http } from '@/utils/http'
import type { ExecutionDetail, ExecutionListParams, ExecutionListResponse } from '@/types'

export const executionApi = {
  list(params: ExecutionListParams = {}) {
    return http.get<ExecutionListResponse>('/executions', { params })
  },
  get(executionId: string) {
    return http.get<ExecutionDetail>(`/executions/${executionId}`)
  },
}