// pages/organizations/List.tsx
// 我的组织列表：卡片网格 + 创建组织；创建成功切换当前组织并进入成员管理
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { z } from 'zod'

import { organizationApi } from '@/api'
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
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-neutral-900">我的组织</h2>
        <button
          type="button"
          onClick={() => document.getElementById('create-org-form')?.scrollIntoView()}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700"
        >
          创建组织
        </button>
      </div>

      {isPending ? (
        <p className="mt-6 text-sm text-neutral-500">加载中…</p>
      ) : organizations && organizations.length > 0 ? (
        <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {organizations.map((org) => (
            <li
              key={org.id}
              className="flex flex-col justify-between rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm"
            >
              <div>
                <div className="flex items-center justify-between">
                  <h3 className="truncate text-base font-semibold text-neutral-900">
                    {org.name}
                  </h3>
                  <span className="shrink-0 rounded-full bg-indigo-50 px-3 py-0.5 text-xs font-medium text-indigo-700">
                    {ORG_ROLE_LABELS[org.role]}
                  </span>
                </div>
                <p className="mt-2 text-xs text-neutral-500">
                  拥有者 {org.owner_username} · {org.member_count} 名成员
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleEnter(org.id)}
                className="mt-4 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 transition hover:bg-neutral-100"
              >
                进入组织
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-6 rounded-2xl border border-dashed border-neutral-300 bg-white p-8 text-center">
          <p className="text-sm text-neutral-500">尚未加入任何组织，创建一个开始使用</p>
        </div>
      )}

      <form
        id="create-org-form"
        onSubmit={onSubmit}
        noValidate
        className="mt-8 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm"
      >
        <h3 className="text-base font-semibold text-neutral-900">创建组织</h3>
        <p className="mt-1 text-xs text-neutral-500">创建后您将成为组织拥有者</p>
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
            className="shrink-0 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {createMutation.isPending ? '创建中…' : '创建'}
          </button>
        </div>
        {apiError ? <p className="mt-3 text-sm text-red-500">{apiError}</p> : null}
      </form>
    </div>
  )
}