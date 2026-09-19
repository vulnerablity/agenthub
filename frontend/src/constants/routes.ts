// constants/routes.ts
// 路由路径统一常量
export const ROUTE_PATHS = {
  LOGIN: '/login',
  REGISTER: '/register',
  HOME: '/',
  ORGANIZATIONS: '/organizations',
  ORG_MEMBERS: '/organizations/:orgId/members',
  ORG_SETTINGS: '/organizations/:orgId/settings',
} as const

/** 生成带组织 id 的成员管理路径 */
export function orgMembersPath(orgId: number | string): string {
  return `/organizations/${orgId}/members`
}

/** 生成带组织 id 的组织设置路径 */
export function orgSettingsPath(orgId: number | string): string {
  return `/organizations/${orgId}/settings`
}