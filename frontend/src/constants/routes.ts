// constants/routes.ts
// 路由路径统一常量
export const ROUTE_PATHS = {
  LOGIN: '/login',
  REGISTER: '/register',
  HOME: '/',
  ORGANIZATIONS: '/organizations',
  ORG_MEMBERS: '/organizations/:orgId/members',
  ORG_SETTINGS: '/organizations/:orgId/settings',
  AGENTS: '/organizations/:orgId/agents',
  AGENT_NEW: '/organizations/:orgId/agents/new',
  AGENT_DETAIL: '/organizations/:orgId/agents/:agentId',
  AGENT_EDIT: '/organizations/:orgId/agents/:agentId/edit',
  AGENT_VERSION_NEW: '/organizations/:orgId/agents/:agentId/versions/new',
  CHAT: '/organizations/:orgId/chat',
  CHAT_CONVERSATION: '/organizations/:orgId/chat/:conversationId',
  KNOWLEDGE_BASES: '/organizations/:orgId/knowledge-bases',
  KNOWLEDGE_BASE_NEW: '/organizations/:orgId/knowledge-bases/new',
  KNOWLEDGE_BASE_DETAIL: '/organizations/:orgId/knowledge-bases/:kbId',
  KNOWLEDGE_BASE_EDIT: '/organizations/:orgId/knowledge-bases/:kbId/edit',
  TOOLS: '/organizations/:orgId/tools',
  TOOL_NEW: '/organizations/:orgId/tools/new',
  TOOL_DETAIL: '/organizations/:orgId/tools/:toolId',
  TOOL_EDIT: '/organizations/:orgId/tools/:toolId/edit',
  EXECUTIONS: '/organizations/:orgId/executions',
  EXECUTION_DETAIL: '/organizations/:orgId/executions/:executionId',
} as const

/** 生成带组织 id 的成员管理路径 */
export function orgMembersPath(orgId: number | string): string {
  return `/organizations/${orgId}/members`
}

/** 生成带组织 id 的组织设置路径 */
export function orgSettingsPath(orgId: number | string): string {
  return `/organizations/${orgId}/settings`
}

/** 生成带组织 id 的智能体列表路径 */
export function agentsPath(orgId: number | string): string {
  return `/organizations/${orgId}/agents`
}

/** 生成带组织 id 的新建智能体路径 */
export function agentNewPath(orgId: number | string): string {
  return `/organizations/${orgId}/agents/new`
}

/** 生成带组织与智能体 id 的详情路径 */
export function agentDetailPath(orgId: number | string, agentId: number | string): string {
  return `/organizations/${orgId}/agents/${agentId}`
}

/** 生成带组织与智能体 id 的编辑路径 */
export function agentEditPath(orgId: number | string, agentId: number | string): string {
  return `/organizations/${orgId}/agents/${agentId}/edit`
}

/** 生成带组织与智能体 id 的新建版本路径 */
export function agentVersionNewPath(
  orgId: number | string,
  agentId: number | string,
): string {
  return `/organizations/${orgId}/agents/${agentId}/versions/new`
}

/** 生成带组织 id 的对话页路径 */
export function chatPath(orgId: number | string): string {
  return `/organizations/${orgId}/chat`
}

/** 生成带组织与会话 id 的对话页路径 */
export function chatConversationPath(
  orgId: number | string,
  conversationId: number | string,
): string {
  return `/organizations/${orgId}/chat/${conversationId}`
}

/** 生成带组织 id 的知识库列表路径 */
export function knowledgeBasesPath(orgId: number | string): string {
  return `/organizations/${orgId}/knowledge-bases`
}

/** 生成带组织 id 的新建知识库路径 */
export function knowledgeBaseNewPath(orgId: number | string): string {
  return `/organizations/${orgId}/knowledge-bases/new`
}

/** 生成带组织与知识库 id 的详情路径 */
export function knowledgeBaseDetailPath(
  orgId: number | string,
  kbId: number | string,
): string {
  return `/organizations/${orgId}/knowledge-bases/${kbId}`
}

/** 生成带组织与知识库 id 的编辑路径 */
export function knowledgeBaseEditPath(
  orgId: number | string,
  kbId: number | string,
): string {
  return `/organizations/${orgId}/knowledge-bases/${kbId}/edit`
}

/** 生成带组织 id 的工具列表路径 */
export function toolsPath(orgId: number | string): string {
  return `/organizations/${orgId}/tools`
}

/** 生成带组织 id 的新建工具路径 */
export function toolNewPath(orgId: number | string): string {
  return `/organizations/${orgId}/tools/new`
}

/** 生成带组织与工具 id 的详情路径 */
export function toolDetailPath(orgId: number | string, toolId: number | string): string {
  return `/organizations/${orgId}/tools/${toolId}`
}

/** 生成带组织与工具 id 的编辑路径 */
export function toolEditPath(orgId: number | string, toolId: number | string): string {
  return `/organizations/${orgId}/tools/${toolId}/edit`
}

/** 生成带组织 id 的执行监控列表路径 */
export function executionsPath(orgId: number | string): string {
  return `/organizations/${orgId}/executions`
}

/** 生成带组织与执行 id 的详情路径 */
export function executionDetailPath(
  orgId: number | string,
  executionId: string,
): string {
  return `/organizations/${orgId}/executions/${executionId}`
}