// api/agents.ts
// 智能体接口封装：与后端 /api/v1/agents 对齐（组织隔离经 X-Organization-Id 请求头自动携带）
import { http } from '@/utils/http'
import type {
  AgentCreateRequest,
  AgentDetail,
  AgentListItem,
  AgentStatus,
  AgentStatusRequest,
  AgentUpdateRequest,
  AgentVersionCreateRequest,
  AgentVersionItem,
} from '@/types'

export interface AgentListParams {
  name?: string
  status?: AgentStatus
}

export const agentApi = {
  create(data: AgentCreateRequest) {
    return http.post<AgentDetail>('/agents', data)
  },
  list(params?: AgentListParams) {
    return http.get<AgentListItem[]>('/agents', { params })
  },
  get(agentId: number) {
    return http.get<AgentDetail>(`/agents/${agentId}`)
  },
  update(agentId: number, data: AgentUpdateRequest) {
    return http.patch<AgentDetail>(`/agents/${agentId}`, data)
  },
  setStatus(agentId: number, data: AgentStatusRequest) {
    return http.patch<AgentDetail>(`/agents/${agentId}/status`, data)
  },
  remove(agentId: number) {
    return http.delete(`/agents/${agentId}`)
  },
  listVersions(agentId: number) {
    return http.get<AgentVersionItem[]>(`/agents/${agentId}/versions`)
  },
  createVersion(agentId: number, data: AgentVersionCreateRequest) {
    return http.post<AgentVersionItem>(`/agents/${agentId}/versions`, data)
  },
  publishVersion(agentId: number, versionId: number) {
    return http.post<AgentDetail>(`/agents/${agentId}/versions/${versionId}/publish`)
  },
  rollbackVersion(agentId: number, versionId: number) {
    return http.post<AgentDetail>(`/agents/${agentId}/versions/${versionId}/rollback`)
  },
}