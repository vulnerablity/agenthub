// pages/organizations/List.tsx
// 我的组织列表：卡片网格 + 创建组织；创建成功切换当前组织并进入成员管理
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { z } from 'zod'

import { organizationApi } from '@/api'
import Icon from '@/components/Icon'
import TextField from '@/components/form/TextField'
import { errorMessage } from '@/constants/error-messages'
import { ORG_ROLE_LABELS } from '@/constants/org-roles'
import { orgMembersPath } from '@/constants/routes'
import { ME_QUERY_KEY } from '@/hooks/useMe'
import { MY_ORGS_QUERY_KEY, useMyOrganizations } from '@/hooks/useMyOrganizations'
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

  return (
    <div className="mx-auto max-w-4xl">
      <div className="page-head">
        <div>
          <h1 className="page-title">我的组织</h1>
          <p className="page-sub">创建并管理你的企业组织与成员</p>
        </div>
        <button
          type="button"
          onClick={() => document.getElementById('create-org-form')?.scrollIntoView()}
          className="btn primary"
        >
          <Icon name="plus" className="ic" />
          创建组织
        </button>
      </div>

      {isPending ? (
        <p className="mt-6 muted">加载中…</p>
      ) : organizations && organizations.length > 0 ? (
        <ul className="grid g2 mt-6">
          {organizations.map((org) => (
            <li key={org.id} className="card card-pad flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="avatar md av-5">{org.name.slice(0, 1).toUpperCase()}</span>
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
                  className="btn primary sm ml-auto"
                >
                  进入组织
                </button>
              </div>
            </li>
          ))}
        </ul>
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
    </div>
  )
}
