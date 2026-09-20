// pages/Home.tsx
// 登录后概览页：当前组织概要 + 快捷入口；无组织时引导创建
import { Link } from 'react-router-dom'

import { ORG_ROLE_LABELS } from '@/constants/org-roles'
import { orgMembersPath, orgSettingsPath, ROUTE_PATHS } from '@/constants/routes'
import { useMe } from '@/hooks/useMe'
import { useMyOrganizations } from '@/hooks/useMyOrganizations'
import { useOrganizationStore } from '@/stores/organization'

export default function Home() {
  const { data: me, isPending } = useMe()
  const currentOrgId = useOrganizationStore((state) => state.currentOrgId)
  const { data: organizations } = useMyOrganizations()
  const currentOrg = organizations?.find((org) => org.id === currentOrgId)

  return (
    <div className="mx-auto max-w-3xl">
      <h2 className="text-xl font-semibold text-neutral-900">
        你好，{isPending ? '…' : me?.username}
      </h2>
      <p className="mt-1 text-sm text-neutral-500">{me?.email}</p>

      <div className="mt-8">
        <h3 className="text-sm font-medium text-neutral-700">当前组织</h3>
        {currentOrg ? (
          <div className="mt-3 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-base font-semibold text-neutral-900">
                  {currentOrg.name}
                </h4>
                <p className="mt-1 text-xs text-neutral-500">
                  企业拥有者 {currentOrg.owner_username} · {currentOrg.member_count} 名成员
                </p>
              </div>
              <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700">
                {ORG_ROLE_LABELS[currentOrg.role]}
              </span>
            </div>
            <div className="mt-5 flex gap-3">
              <Link
                to={orgMembersPath(currentOrg.id)}
                className="rounded-lg border border-neutral-300 px-4 py-2 text-sm text-neutral-700 transition hover:bg-neutral-100"
              >
                成员管理
              </Link>
              <Link
                to={orgSettingsPath(currentOrg.id)}
                className="rounded-lg border border-neutral-300 px-4 py-2 text-sm text-neutral-700 transition hover:bg-neutral-100"
              >
                组织设置
              </Link>
            </div>
          </div>
        ) : (
          <div className="mt-3 rounded-2xl border border-dashed border-neutral-300 bg-white p-6 text-center">
            <p className="text-sm text-neutral-500">尚未加入任何组织</p>
            <Link
              to={ROUTE_PATHS.ORGANIZATIONS}
              className="mt-4 inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700"
            >
              创建组织
            </Link>
          </div>
        )}
      </div>

      {organizations && organizations.length > 0 ? (
        <div className="mt-8">
          <h3 className="text-sm font-medium text-neutral-700">
            我的组织（{organizations.length}）
          </h3>
          <ul className="mt-3 flex flex-col gap-2">
            {organizations.map((org) => (
              <li
                key={org.id}
                className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white px-4 py-3 text-sm"
              >
                <span className="text-neutral-900">{org.name}</span>
                <span className="rounded-full bg-indigo-50 px-3 py-0.5 text-xs font-medium text-indigo-700">
                  {ORG_ROLE_LABELS[org.role]}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}