// types/organization.ts
// 组织协议类型：与 backend/app/schemas/organization.py 一一对应
export type OrgRole = 'owner' | 'admin' | 'member' | 'viewer'

/** 添加成员时可分配的角色（owner 只能通过转让变更） */
export type AssignableRole = Exclude<OrgRole, 'owner'>

export interface OrganizationCreateRequest {
  name: string
}

export interface OrganizationUpdateRequest {
  name: string
}

export interface OrganizationDetail {
  id: number
  name: string
  owner_id: number
  owner_username: string
  my_role: OrgRole
  member_count: number
  created_at: string
}

export interface OrganizationListItem {
  id: number
  name: string
  role: OrgRole
  owner_username: string
  member_count: number
  created_at: string
}

export interface MemberResponse {
  user_id: number
  email: string
  username: string
  avatar_url: string | null
  role: OrgRole
  joined_at: string
}

export interface MemberAddRequest {
  email: string
  role: AssignableRole
}

export interface MemberUpdateRequest {
  role: OrgRole
}