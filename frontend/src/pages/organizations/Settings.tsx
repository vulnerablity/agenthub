// pages/organizations/Settings.tsx
// 组织设置：基本信息与改名（owner/admin）、转让与解散危险区（仅 owner）
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { z } from 'zod'

import { organizationApi } from '@/api'
import TextField from '@/components/form/TextField'
import { errorMessage } from '@/constants/error-messages'
import { ROUTE_PATHS } from '@/constants/routes'
import { ME_QUERY_KEY } from '@/hooks/useMe'
import { MY_ORGS_QUERY_KEY } from '@/hooks/useMyOrganizations'
import { orgQueryKey, useOrg } from '@/hooks/useOrg'
import { orgMembersQueryKey, useOrgMembers } from '@/hooks/useOrgMembers'
import { useOrganizationStore } from '@/stores/organization'

const nameSchema = z.object({
  name: z.string().min(1, '请输入组织名称').max(100, '组织名称最多 100 个字符'),
})

type NameForm = z.infer<typeof nameSchema>

export default function Settings() {
  const { orgId: orgIdParam } = useParams()
  const orgId = orgIdParam ? Number(orgIdParam) : null

  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const setCurrentOrg = useOrganizationStore((state) => state.setCurrentOrg)
  const { data: org } = useOrg(orgId)
  const { data: members } = useOrgMembers(orgId)
  const [apiError, setApiError] = useState('')
  const [confirmName, setConfirmName] = useState('')
  const [transferTarget, setTransferTarget] = useState<number | null>(null)

  const myRole = org?.my_role
  const isOwner = myRole === 'owner'
  const canRename = myRole === 'owner' || myRole === 'admin'

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<NameForm>({
    resolver: zodResolver(nameSchema),
    defaultValues: { name: '' },
  })

  // 组织详情到达后回填名称表单
  useEffect(() => {
    if (org) reset({ name: org.name })
  }, [org, reset])

  const renameMutation = useMutation({
    mutationFn: (values: NameForm) => organizationApi.update(orgId!, values),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: orgQueryKey(orgId!) }),
        queryClient.invalidateQueries({ queryKey: MY_ORGS_QUERY_KEY }),
      ])
    },
    onError: (error) => setApiError(errorMessage(error)),
  })

  const transferMutation = useMutation({
    mutationFn: (targetUserId: number) =>
      organizationApi.updateMember(orgId!, targetUserId, { role: 'owner' }),
    onSuccess: async () => {
      // 转让后双方角色变化：刷新 me、组织详情、成员与组织列表
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: orgQueryKey(orgId!) }),
        queryClient.invalidateQueries({ queryKey: orgMembersQueryKey(orgId!, undefined) }),
        queryClient.invalidateQueries({ queryKey: MY_ORGS_QUERY_KEY }),
      ])
      setTransferTarget(null)
    },
    onError: (error) => setApiError(errorMessage(error)),
  })

  const dissolveMutation = useMutation({
    mutationFn: () => organizationApi.remove(orgId!),
    onSuccess: async () => {
      setCurrentOrg(null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: MY_ORGS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY }),
        queryClient.removeQueries({ queryKey: ['org', orgId] }),
      ])
      navigate(ROUTE_PATHS.ORGANIZATIONS)
    },
    onError: (error) => setApiError(errorMessage(error)),
  })

  if (orgId == null || Number.isNaN(orgId)) {
    return <p className="text-sm text-neutral-500">组织参数无效</p>
  }

  const onRename = handleSubmit((values) => {
    setApiError('')
    renameMutation.mutate(values)
  })

  const handleTransfer = () => {
    if (transferTarget == null) return
    setApiError('')
    const target = members?.find((m) => m.user_id === transferTarget)
    if (
      target &&
      window.confirm(`确定将组织转让给 ${target.username}？您将变为管理员，此操作不可撤销。`)
    ) {
      transferMutation.mutate(transferTarget)
    }
  }

  const handleDissolve = () => {
    setApiError('')
    if (window.confirm('确定解散该组织？所有成员关系将被删除，此操作不可撤销。')) {
      dissolveMutation.mutate()
    }
  }

  const transferable = members?.filter((m) => m.role !== 'owner') ?? []
  const dissolveDisabled = confirmName !== org?.name || dissolveMutation.isPending

  return (
    <div className="mx-auto max-w-2xl">
      <h2 className="text-xl font-semibold text-neutral-900">组织设置</h2>
      <p className="mt-1 text-sm text-neutral-500">{org?.name ?? '加载中…'}</p>

      {apiError ? <p className="mt-4 text-sm text-red-500">{apiError}</p> : null}

      <section className="mt-6 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h3 className="text-base font-semibold text-neutral-900">基本信息</h3>
        <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-neutral-400">拥有者</dt>
            <dd className="mt-1 text-neutral-900">{org?.owner_username ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-neutral-400">成员数</dt>
            <dd className="mt-1 text-neutral-900">{org?.member_count ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-neutral-400">创建时间</dt>
            <dd className="mt-1 text-neutral-900">
              {org ? new Date(org.created_at).toLocaleString('zh-CN') : '—'}
            </dd>
          </div>
        </dl>

        {canRename ? (
          <form onSubmit={onRename} noValidate className="mt-6 border-t border-neutral-100 pt-5">
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <TextField
                  label="组织名称"
                  error={errors.name?.message}
                  {...register('name')}
                />
              </div>
              <button
                type="submit"
                disabled={renameMutation.isPending}
                className="shrink-0 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {renameMutation.isPending ? '保存中…' : '保存'}
              </button>
            </div>
          </form>
        ) : null}
      </section>

      {isOwner ? (
        <section className="mt-6 rounded-2xl border border-red-200 bg-white p-6 shadow-sm">
          <h3 className="text-base font-semibold text-red-600">危险区</h3>

          <div className="mt-4 border-t border-neutral-100 pt-5">
            <p className="text-sm font-medium text-neutral-900">转让组织</p>
            <p className="mt-1 text-xs text-neutral-500">
              将拥有者角色转让给一名成员，您将变为管理员
            </p>
            <div className="mt-3 flex items-center gap-3">
              <select
                value={transferTarget ?? ''}
                onChange={(e) => setTransferTarget(Number(e.target.value))}
                className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              >
                <option value="" disabled>
                  选择新拥有者…
                </option>
                {transferable.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.username}（{m.email}）
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={transferTarget == null || transferMutation.isPending}
                onClick={handleTransfer}
                className="shrink-0 rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {transferMutation.isPending ? '转让中…' : '转让'}
              </button>
            </div>
          </div>

          <div className="mt-6 border-t border-neutral-100 pt-5">
            <p className="text-sm font-medium text-neutral-900">解散组织</p>
            <p className="mt-1 text-xs text-neutral-500">
              请输入组织名称确认，解散后所有成员关系将被删除
            </p>
            <div className="mt-3 flex items-center gap-3">
              <input
                type="text"
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                placeholder={org?.name}
                className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-900 outline-none transition focus:border-red-500 focus:ring-2 focus:ring-red-100"
              />
              <button
                type="button"
                disabled={dissolveDisabled}
                onClick={handleDissolve}
                className="shrink-0 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {dissolveMutation.isPending ? '解散中…' : '解散组织'}
              </button>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  )
}