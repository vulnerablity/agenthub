// pages/organizations/Settings.tsx
// 组织设置：基本信息与改名（owner/admin）、转让与解散危险区（仅 owner）
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { z } from 'zod'

import { organizationApi } from '@/api'
import Icon from '@/components/Icon'
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
    return <p className="muted">组织参数无效</p>
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
      <div className="page-head">
        <div>
          <h1 className="page-title">组织设置</h1>
          <p className="page-sub">{org?.name ?? '加载中…'}</p>
        </div>
      </div>

      {apiError ? <p className="mt-4 text-[13px] text-red-500">{apiError}</p> : null}

      <section className="card card-pad">
        <h3 className="card-title">
          <Icon name="settings" className="ic" />
          基本信息
        </h3>
        <dl className="kv mt-3">
          <div className="row">
            <dt>企业拥有者</dt>
            <dd>{org?.owner_username ?? '—'}</dd>
          </div>
          <div className="row">
            <dt>成员数</dt>
            <dd>{org?.member_count ?? '—'}</dd>
          </div>
          <div className="row">
            <dt>创建时间</dt>
            <dd>{org ? new Date(org.created_at).toLocaleString('zh-CN') : '—'}</dd>
          </div>
        </dl>

        {canRename ? (
          <form onSubmit={onRename} noValidate className="mt-4 border-t border-[var(--line)] pt-4">
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <TextField label="组织名称" error={errors.name?.message} {...register('name')} />
              </div>
              <button type="submit" disabled={renameMutation.isPending} className="btn primary">
                {renameMutation.isPending ? '保存中…' : '保存'}
              </button>
            </div>
          </form>
        ) : null}
      </section>

      {isOwner ? (
        <section
          className="card card-pad mt-5"
          style={{ borderColor: '#f2c6c6', background: '#fffafa' }}
        >
          <h3 className="card-title" style={{ color: 'var(--red)' }}>
            <Icon name="alert" className="ic" />
            危险区
          </h3>

          <div className="mt-3 border-t border-[var(--line)] pt-4">
            <p className="font-medium">转让组织</p>
            <p className="mt-1 text-[12.5px] muted">
              将企业拥有者角色转让给一名成员，您将变为管理员
            </p>
            <div className="mt-3 flex items-center gap-3">
              <select
                value={transferTarget ?? ''}
                onChange={(e) => setTransferTarget(Number(e.target.value))}
                className="select flex-1"
              >
                <option value="" disabled>
                  选择新企业拥有者…
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
                className="btn sm danger-ghost"
              >
                {transferMutation.isPending ? '转让中…' : '转让'}
              </button>
            </div>
          </div>

          <div className="mt-5 border-t border-[var(--line)] pt-4">
            <p className="font-medium">解散组织</p>
            <p className="mt-1 text-[12.5px] muted">
              请输入组织名称确认，解散后所有成员关系将被删除
            </p>
            <div className="mt-3 flex items-center gap-3">
              <div className="input flex-1" style={{ borderColor: '#f2c6c6' }}>
                <Icon name="edit" className="ic" />
                <input
                  type="text"
                  value={confirmName}
                  onChange={(e) => setConfirmName(e.target.value)}
                  placeholder={org?.name}
                />
              </div>
              <button
                type="button"
                disabled={dissolveDisabled}
                onClick={handleDissolve}
                className="btn danger sm"
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
