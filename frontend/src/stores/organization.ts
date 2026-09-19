// stores/organization.ts
// 当前组织上下文：仅存 currentOrgId 并持久化；组织数据本体由 React Query 管理
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface OrganizationState {
  currentOrgId: number | null
  setCurrentOrg: (orgId: number | null) => void
}

export const useOrganizationStore = create<OrganizationState>()(
  persist(
    (set) => ({
      currentOrgId: null,
      setCurrentOrg: (currentOrgId) => set({ currentOrgId }),
    }),
    // key 前缀与 utils/token 保持一致，内容互不干扰
    { name: 'agenthub.current_org_id' },
  ),
)