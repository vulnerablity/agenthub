// api/agents.ts
// 智能体接口封装：与后端 /api/v1/organizations/{orgId}/agents 对齐
import { http } from '@/utils/http'
import type {
  AgentCreateRequest,
  AgentDetail,
  AgentListItem,
  AgentStatus,
  AgentStatusRequest,
  AgentUpdateRequest,
} from '@/types'

export interface AgentListParams {
  name?: string
  status?: AgentStatus
}

export const agentApi = {
  create(orgId: number, data: AgentCreateRequest) {
    return http.post<AgentDetail>(`/organizations/${orgId}/agents`, data)
  },
  list(orgId: number, params?: AgentListParams) {
    return http.get<AgentListItem[]>(`/organizations/${orgId}/agents`, { params })
  },
  get(orgId: number, agentId: number) {
    return http.get<AgentDetail>(`/organizations/${orgId}/agents/${agentId}`)
  },
  update(orgId: number, agentId: number, data: AgentUpdateRequest) {
    return http.patch<AgentDetail>(`/organizations/${orgId}/agents/${agentId}`, data)
  },
  setStatus(orgId: number, agentId: number, data: AgentStatusRequest) {
    return http.patch<AgentDetail>(
      `/organizations/${orgId}/agents/${agentId}/status`,
      data,
    )
  },
  remove(orgId: number, agentId: number) {
    return http.delete(`/organizations/${orgId}/agents/${agentId}`)
  },
}