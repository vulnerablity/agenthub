// pages/organizations/Settings.tsx
// 组织设置：基本信息与改名（owner/admin）、转让与解散危险区（仅 owner）
import { useEffect, useState } from 'react'
import type { ChangeEvent } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { z } from 'zod'

import { organizationApi } from '@/api'
import Icon from '@/components/Icon'
import OrganizationAvatar from '@/components/organization/OrganizationAvatar'
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
  const [avatarError, setAvatarError] = useState('')
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null)
  const [croppedAvatarFile, setCroppedAvatarFile] = useState<File | null>(null)

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

  useEffect(() => () => {
    if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl)
  }, [avatarPreviewUrl])

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

  const avatarMutation = useMutation({
    mutationFn: (file: File) => organizationApi.uploadAvatar(orgId!, file),
    onSuccess: async () => {
      setAvatarError('')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: orgQueryKey(orgId!) }),
        queryClient.invalidateQueries({ queryKey: MY_ORGS_QUERY_KEY }),
      ])
    },
    onError: (error) => setAvatarError(errorMessage(error)),
  })
  const removeAvatarMutation = useMutation({
    mutationFn: () => organizationApi.removeAvatar(orgId!),
    onSuccess: async () => {
      setAvatarError('')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: orgQueryKey(orgId!) }),
        queryClient.invalidateQueries({ queryKey: MY_ORGS_QUERY_KEY }),
      ])
    },
    onError: (error) => setAvatarError(errorMessage(error)),
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
  if (org && !canRename) return <p className="muted">没有组织管理权限</p>

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
      window.confirm(`确定将组织转让给 ${target.username}？您将变为普通成员，此操作不可撤销。`)
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
            <dt>组织头像</dt>
            <dd className="flex items-center gap-3">
              <OrganizationAvatar name={org?.name ?? '组织'} avatarUrl={org?.avatar_url} organizationId={orgId} size="lg" />
              {canRename ? <div className="flex flex-wrap gap-2">
                <label className={`btn sm ${avatarMutation.isPending ? 'opacity-50' : ''}`}>
                  {avatarMutation.isPending ? '上传中…' : org?.avatar_url ? '替换头像' : '上传头像'}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="sr-only"
                    disabled={avatarMutation.isPending}
                    onChange={async (event: ChangeEvent<HTMLInputElement>) => {
                      const file = event.target.files?.[0]
                      event.target.value = ''
                      if (!file) return
                      if (file.size > 5 * 1024 * 1024) {
                        setAvatarError('头像文件不能超过 5MB')
                        return
                      }
                      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
                        setAvatarError('头像仅支持 JPG、PNG 或 WebP')
                        return
                      }
                      try {
                        const bitmap = await createImageBitmap(file)
                        const edge = Math.min(bitmap.width, bitmap.height)
                        const originX = (bitmap.width - edge) / 2
                        const originY = (bitmap.height - edge) / 2
                        const canvas = document.createElement('canvas')
                        canvas.width = 512
                        canvas.height = 512
                        const context = canvas.getContext('2d')
                        if (!context) throw new Error('无法处理该图片')
                        context.drawImage(bitmap, originX, originY, edge, edge, 0, 0, 512, 512)
                        bitmap.close()
                        const blob = await new Promise<Blob>((resolve, reject) => {
                          canvas.toBlob((value) => value ? resolve(value) : reject(new Error('图片裁剪失败')), 'image/webp', 0.9)
                        })
                        if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl)
                        setCroppedAvatarFile(new File([blob], 'organization-avatar.webp', { type: 'image/webp' }))
                        setAvatarPreviewUrl(URL.createObjectURL(blob))
                        setAvatarError('')
                      } catch {
                        setAvatarError('无法读取或裁剪该图片文件')
                      }
                    }}
                  />
                </label>
                {avatarPreviewUrl ? <button type="button" className="btn primary sm" disabled={avatarMutation.isPending} onClick={() => {
                  if (croppedAvatarFile) avatarMutation.mutate(croppedAvatarFile)
                  setAvatarPreviewUrl(null)
                  setCroppedAvatarFile(null)
                }}>确认裁剪并上传</button> : null}
                {avatarPreviewUrl ? <button type="button" className="btn sm" onClick={() => {
                  URL.revokeObjectURL(avatarPreviewUrl)
                  setAvatarPreviewUrl(null)
                  setCroppedAvatarFile(null)
                }}>取消</button> : null}
                {org?.avatar_url ? <button type="button" onClick={() => {
                  if (window.confirm('移除组织头像并恢复首字头像？')) removeAvatarMutation.mutate()
                }} disabled={removeAvatarMutation.isPending} className="btn sm">移除头像</button> : null}
              </div> : null}
            </dd>
          </div>
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
        {avatarError ? <p className="mt-3 text-[13px] text-red-500">{avatarError}</p> : null}
        {avatarPreviewUrl ? <div className="mt-3 flex items-center gap-3 rounded-lg border border-[var(--line)] p-3">
          <img src={avatarPreviewUrl} alt="裁剪后的头像预览" className="avatar lg object-cover" />
          <span className="text-sm muted">已按中心裁剪为 1:1，可确认上传或重新选择</span>
        </div> : null}

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
              将企业拥有者角色转让给一名成员，您将变为普通成员
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
