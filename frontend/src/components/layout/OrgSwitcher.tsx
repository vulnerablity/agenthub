// components/layout/OrgSwitcher.tsx
// 组织切换器：下拉切换当前组织，无组织时引导创建；停留详情页时同步跳转新组织路径
import { useEffect } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'

import { ROUTE_PATHS } from '@/constants/routes'
import { useMyOrganizations } from '@/hooks/useMyOrganizations'
import { useOrganizationStore } from '@/stores/organization'

export default function OrgSwitcher() {
  const navigate = useNavigate()
  const location = useLocation()
  const currentOrgId = useOrganizationStore((state) => state.currentOrgId)
  const setCurrentOrg = useOrganizationStore((state) => state.setCurrentOrg)
  const { data: organizations, isPending } = useMyOrganizations()

  // 当前组织已被解散/退出或未设置时，回落到第一个组织
  useEffect(() => {
    if (isPending || !organizations) return
    if (organizations.length === 0) {
      if (currentOrgId !== null) setCurrentOrg(null)
      return
    }
    if (!organizations.some((org) => org.id === currentOrgId)) {
      setCurrentOrg(organizations[0].id)
    }
  }, [organizations, isPending, currentOrgId, setCurrentOrg])

  const handleChange = (orgId: number) => {
    setCurrentOrg(orgId)
    // 停留在 /organizations/:orgId/... 时，切换到新组织的同路径页面
    const match = location.pathname.match(/^\/organizations\/\d+(\/.*)?$/)
    if (match) {
      navigate(
        location.pathname.replace(/\/organizations\/\d+/, `/organizations/${orgId}`),
        { replace: true },
      )
    }
  }

  if (isPending) {
    return <p className="px-3 text-sm text-neutral-400">加载中…</p>
  }
  if (!organizations || organizations.length === 0) {
    return (
      <Link
        to={ROUTE_PATHS.ORGANIZATIONS}
        className="block rounded-lg border border-dashed border-neutral-300 px-3 py-2 text-sm text-neutral-500 transition hover:border-indigo-300 hover:text-indigo-600"
      >
        创建或加入组织
      </Link>
    )
  }

  return (
    <select
      value={currentOrgId ?? undefined}
      onChange={(e) => handleChange(Number(e.target.value))}
      className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
    >
      {organizations.map((org) => (
        <option key={org.id} value={org.id}>
          {org.name}
        </option>
      ))}
    </select>
  )
}