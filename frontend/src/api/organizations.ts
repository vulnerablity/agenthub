// api/organizations.ts
// 组织与成员接口封装：与后端 /api/v1/organizations 对齐
import { http } from '@/utils/http'
import type {
  MemberAddRequest,
  MemberResponse,
  MemberUpdateRequest,
  OrganizationCreateRequest,
  OrganizationDetail,
  OrganizationListItem,
  OrganizationUpdateRequest,
} from '@/types'

export const organizationApi = {
  create(data: OrganizationCreateRequest) {
    return http.post<OrganizationDetail>('/organizations', data)
  },
  list() {
    return http.get<OrganizationListItem[]>('/organizations')
  },
  get(orgId: number) {
    return http.get<OrganizationDetail>(`/organizations/${orgId}`)
  },
  update(orgId: number, data: OrganizationUpdateRequest) {
    return http.patch<OrganizationDetail>(`/organizations/${orgId}`, data)
  },
  remove(orgId: number) {
    return http.delete(`/organizations/${orgId}`)
  },
  listMembers(orgId: number, email?: string) {
    return http.get<MemberResponse[]>(`/organizations/${orgId}/members`, {
      params: email ? { email } : undefined,
    })
  },
  addMember(orgId: number, data: MemberAddRequest) {
    return http.post<MemberResponse>(`/organizations/${orgId}/members`, data)
  },
  updateMember(orgId: number, userId: number, data: MemberUpdateRequest) {
    return http.patch<MemberResponse>(`/organizations/${orgId}/members/${userId}`, data)
  },
  removeMember(orgId: number, userId: number) {
    return http.delete(`/organizations/${orgId}/members/${userId}`)
  },
  leave(orgId: number) {
    return http.delete(`/organizations/${orgId}/members/me`)
  },
}