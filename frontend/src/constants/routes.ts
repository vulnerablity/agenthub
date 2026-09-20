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