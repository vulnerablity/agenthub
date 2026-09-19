// constants/org-roles.ts
// 组织角色常量：中文文案与可分配角色集合（与后端 roles 预置数据一致）
import type { AssignableRole, OrgRole } from '@/types'

export const ORG_ROLE_LABELS: Record<OrgRole, string> = {
  owner: '拥有者',
  admin: '管理员',
  member: '成员',
  viewer: '访客',
}

/** 添加成员可选角色与成员管理页的降级选项可供性判断使用 */
export const ASSIGNABLE_ROLES: AssignableRole[] = ['admin', 'member', 'viewer']