// api/tools.ts
// 工具接口封装：与后端 /api/v1/tools 与 /agents/{agent_id}/tools 对齐（组织隔离经请求头自动携带）
import { http } from '@/utils/http'
import type {
  AgentToolBindRequest,
  AgentToolDetail,
  ToolCreateRequest,
  ToolDetail,
  ToolTestRequest,
  ToolTestResponse,
  ToolUpdateRequest,
} from '@/types'

export const toolApi = {
  // ---------- 工具 CRUD ----------
  create(data: ToolCreateRequest) {
    return http.post<ToolDetail>('/tools', data)
  },
  list() {
    return http.get<ToolDetail[]>('/tools')
  },
  get(toolId: number) {
    return http.get<ToolDetail>(`/tools/${toolId}`)
  },
  update(toolId: number, data: ToolUpdateRequest) {
    return http.patch<ToolDetail>(`/tools/${toolId}`, data)
  },
  remove(toolId: number) {
    return http.delete(`/tools/${toolId}`)
  },

  // ---------- 工具测试（需求 3.7） ----------
  test(toolId: number, data: ToolTestRequest) {
    return http.post<ToolTestResponse>(`/tools/${toolId}/test`, data)
  },

  // ---------- Agent 绑定（需求 3.7 / 4.7） ----------
  listAgentTools(agentId: number) {
    return http.get<AgentToolDetail[]>(`/agents/${agentId}/tools`)
  },
  bindAgentTool(agentId: number, data: AgentToolBindRequest) {
    return http.post<AgentToolDetail>(`/agents/${agentId}/tools`, data)
  },
  updateAgentTool(agentId: number, toolId: number, data: Partial<AgentToolBindRequest>) {
    return http.patch<AgentToolDetail>(`/agents/${agentId}/tools/${toolId}`, data)
  },
  unbindAgentTool(agentId: number, toolId: number) {
    return http.delete(`/agents/${agentId}/tools/${toolId}`)
  },
}