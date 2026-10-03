// pages/organizations/List.tsx
// 我的组织列表：卡片网格 + 创建组织；创建成功切换当前组织并进入成员管理
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { z } from 'zod'

import { organizationApi } from '@/api'
import Icon from '@/components/Icon'
import OrganizationAvatar from '@/components/organization/OrganizationAvatar'
import TextField from '@/components/form/TextField'
import { errorMessage } from '@/constants/error-messages'
import { ORG_ROLE_LABELS } from '@/constants/org-roles'
import { orgMembersPath, orgSettingsPath } from '@/constants/routes'
import { ME_QUERY_KEY } from '@/hooks/useMe'
import { MY_ORGS_QUERY_KEY, useMyOrganizations } from '@/hooks/useMyOrganizations'
import { orgMembersQueryKey } from '@/hooks/useOrgMembers'
import { orgQueryKey } from '@/hooks/useOrg'
import { useOrganizationStore } from '@/stores/organization'

const createSchema = z.object({
  name: z.string().min(1, '请输入组织名称').max(100, '组织名称最多 100 个字符'),
})

type CreateForm = z.infer<typeof createSchema>

export default function OrganizationList() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const setCurrentOrg = useOrganizationStore((state) => state.setCurrentOrg)
  const { data: organizations, isPending } = useMyOrganizations()
  const [apiError, setApiError] = useState('')
  const [search, setSearch] = useState('')
  const [scope, setScope] = useState<'all' | 'managed'>('all')
  const filteredOrganizations = useMemo(() => (organizations ?? []).filter((org) => {
    const matchesName = org.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
    const matchesScope = scope === 'all' || org.role === 'owner' || org.role === 'admin'
    return matchesName && matchesScope
  }), [organizations, search, scope])

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
    defaultValues: { name: '' },
  })

  const createMutation = useMutation({
    mutationFn: (values: CreateForm) => organizationApi.create(values),
    onSuccess: async ({ data }) => {
      // 组织列表与 me 的组织数组联动
      await queryClient.invalidateQueries({ queryKey: MY_ORGS_QUERY_KEY })
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY })
      setCurrentOrg(data.id)
      navigate(orgMembersPath(data.id))
    },
    onError: (error) => setApiError(errorMessage(error)),
  })

  const onSubmit = handleSubmit((values) => {
    setApiError('')
    createMutation.mutate(values, {
      onSuccess: () => reset(),
    })
  })

  const handleEnter = (orgId: number) => {
    setCurrentOrg(orgId)
    navigate(orgMembersPath(orgId))
  }

  const refreshOrganizations = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: MY_ORGS_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY }),
    ])
  }

  const leaveMutation = useMutation({
    mutationFn: (orgId: number) => organizationApi.leave(orgId),
    onSuccess: refreshOrganizations,
    onError: (error) => setApiError(errorMessage(error)),
  })
  const dissolveMutation = useMutation({
    mutationFn: (orgId: number) => organizationApi.remove(orgId),
    onSuccess: refreshOrganizations,
    onError: (error) => setApiError(errorMessage(error)),
  })
  const transferMutation = useMutation({
    mutationFn: ({ orgId, userId }: { orgId: number; userId: number }) =>
      organizationApi.updateMember(orgId, userId, { role: 'owner' }),
    onSuccess: async (_, variables) => {
      await Promise.all([
        refreshOrganizations(),
        queryClient.invalidateQueries({ queryKey: orgQueryKey(variables.orgId) }),
        queryClient.invalidateQueries({ queryKey: orgMembersQueryKey(variables.orgId, undefined) }),
      ])
    },
    onError: (error) => setApiError(errorMessage(error)),
  })

  const confirmDissolve = (orgId: number, name: string) => {
    if (window.confirm(`确定解散“${name}”？组织资源和成员关系将被删除，此操作不可撤销。`)) {
      dissolveMutation.mutate(orgId)
    }
  }

  const promptTransfer = async (orgId: number, name: string) => {
    const email = window.prompt(`输入新 owner 的已注册邮箱，将“${name}”转让给该成员：`)
    if (!email?.trim()) return
    try {
      const { data: members } = await organizationApi.listMembers(orgId, email.trim())
      const target = members.find((member) => member.email.toLowerCase() === email.trim().toLowerCase())
      if (!target) {
        setApiError('未找到该邮箱对应的组织成员，请先在成员管理中添加成员')
        return
      }
      if (window.confirm(`确定将“${name}”转让给 ${target.username}？您将成为普通成员。`)) {
        transferMutation.mutate({ orgId, userId: target.user_id })
      }
    } catch (error) {
      setApiError(errorMessage(error))
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      {/* <div className="page-head">
        <div>
          <h1 className="page-title">我的组织</h1>
          <p className="page-sub">浏览和切换已加入的组织；管理入口仅对 owner/admin 开放</p>
        </div>
        <button
          type="button"
          onClick={() => document.getElementById('create-org-form')?.scrollIntoView()}
          className="btn primary"
        >
          <Icon name="plus" className="ic" />
          创建组织
        </button>
      </div> */}

      <form
        id="create-org-form"
        onSubmit={onSubmit}
        noValidate
        className="card card-pad mt-6"
      >
        <h3 className="card-title">
          <Icon name="building" className="ic" />
          创建组织
        </h3>
        <p className="card-sub mt-1">创建后您将成为该组织的企业拥有者</p>
        <div className="mt-4 flex items-end gap-3">
          <div className="flex-1">
            <TextField
              label="组织名称"
              placeholder="例如：Acme 团队"
              error={errors.name?.message}
              {...register('name')}
            />
          </div>
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="btn primary"
          >
            {createMutation.isPending ? '创建中…' : '创建'}
          </button>
        </div>
        {apiError ? <p className="mt-3 text-[13px] text-red-500">{apiError}</p> : null}
      </form>

      {isPending ? (
        <p className="mt-6 muted">加载中…</p>
      ) : organizations && organizations.length > 0 ? (
        <>
        <div className="mt-6 flex flex-wrap gap-3">
          <div className="input min-w-56 flex-1">
            <Icon name="search" className="ic" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="按组织名称搜索…" />
          </div>
          <select className="select" value={scope} onChange={(event) => setScope(event.target.value as 'all' | 'managed')}>
            <option value="all">我加入的</option>
            <option value="managed">我管理的</option>
          </select>
        </div>
        {apiError ? <p className="mt-3 text-[13px] text-red-500">{apiError}</p> : null}
        {filteredOrganizations.length ? <ul className="grid g2 mt-4">
          {filteredOrganizations.map((org) => {
            const isOwner = org.role === 'owner'
            const canManage = isOwner || org.role === 'admin'
            return (
            <li key={org.id} className="card card-pad flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <OrganizationAvatar name={org.name} avatarUrl={org.avatar_url} organizationId={org.id} />
                  <h3 className="truncate text-[15px] font-bold">{org.name}</h3>
                </div>
                <span className={`badge ${org.role === 'owner' ? 'accent' : 'info'}`}>
                  {ORG_ROLE_LABELS[org.role]}
                </span>
              </div>
              <p className="text-[12.5px] muted">
                企业拥有者 {org.owner_username} · {org.member_count} 名成员
              </p>
              <div className="row-actions mt-1">
                <button
                  type="button"
                  onClick={() => handleEnter(org.id)}
                  className="btn primary sm"
                >
                  进入组织
                </button>
                {canManage ? <button type="button" onClick={() => navigate(orgSettingsPath(org.id))} className="btn sm">管理</button> : null}
                {isOwner ? <>
                  <button type="button" onClick={() => void promptTransfer(org.id, org.name)} className="btn sm" disabled={transferMutation.isPending}>转让</button>
                  <button type="button" onClick={() => confirmDissolve(org.id, org.name)} className="btn danger sm" disabled={dissolveMutation.isPending}>解散</button>
                </> : <button type="button" onClick={() => {
                  if (window.confirm(`确定退出“${org.name}”？`)) leaveMutation.mutate(org.id)
                }} className="btn sm" disabled={leaveMutation.isPending}>退出</button>}
              </div>
            </li>
          )})}
        </ul> : <div className="empty mt-4"><p>没有符合条件的组织</p></div>}
        </>
      ) : (
        <div className="empty mt-6">
          <Icon name="building" className="ic" />
          <p>尚未加入任何组织，创建一个开始使用</p>
          <div className="actions">
            <button
              type="button"
              className="btn primary sm"
              onClick={() => document.getElementById('create-org-form')?.scrollIntoView()}
            >
              <Icon name="plus" className="ic" />
              创建组织
            </button>
          </div>
        </div>
      )}


    </div>
  )
}
