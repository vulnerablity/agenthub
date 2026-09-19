// pages/organizations/Members.tsx
// 成员管理：搜索、添加、行内改角色、移除与退出；操作入口按角色矩阵渲染（后端为准）
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { z } from 'zod'

import { organizationApi } from '@/api'
import TextField from '@/components/form/TextField'
import { errorMessage } from '@/constants/error-messages'
import { ASSIGNABLE_ROLES, ORG_ROLE_LABELS } from '@/constants/org-roles'
import { useMe } from '@/hooks/useMe'
import { MY_ORGS_QUERY_KEY } from '@/hooks/useMyOrganizations'
import { orgQueryKey, useOrg } from '@/hooks/useOrg'
import { orgMembersQueryKey, useOrgMembers } from '@/hooks/useOrgMembers'
import type { AssignableRole, OrgRole } from '@/types'

const addSchema = z.object({
  email: z.string().min(1, '请输入邮箱').email('邮箱格式不正确'),
  role: z.enum(['admin', 'member', 'viewer']),
})

type AddForm = z.infer<typeof addSchema>

/** 行内角色下拉可见：调用者 owner/admin，目标非自己、非 owner，且 admin 不能管理 admin */
function canAssignRole(callerRole: OrgRole | undefined, targetRole: OrgRole, isSelf: boolean) {
  if (!callerRole || isSelf) return false
  if (callerRole !== 'owner' && callerRole !== 'admin') return false
  if (targetRole === 'owner') return false
  if (callerRole === 'admin' && targetRole === 'admin') return false
  return true
}

/** 移除按钮可见：目标非 owner；admin 不可移除 admin */
function canRemove(callerRole: OrgRole | undefined, targetRole: OrgRole, isSelf: boolean) {
  if (isSelf || !callerRole) return false
  if (callerRole !== 'owner' && callerRole !== 'admin') return false
  if (targetRole === 'owner') return false
  if (callerRole === 'admin' && targetRole === 'admin') return false
  return true
}

export default function Members() {
  const { orgId: orgIdParam } = useParams()
  // 无效 orgId 时 hook 返回空态，页面显示兜底提示
  const orgId = orgIdParam ? Number(orgIdParam) : null

  const queryClient = useQueryClient()
  const { data: me } = useMe()
  const { data: org } = useOrg(orgId)
  const [email, setEmail] = useState('')
  const { data: members, isPending } = useOrgMembers(orgId, email)
  const [apiError, setApiError] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)

  const myRole = org?.my_role
  const canManage = myRole === 'owner' || myRole === 'admin'

  const {
    register: registerAdd,
    handleSubmit: handleAddSubmit,
    reset: resetAdd,
    formState: { errors: addErrors },
  } = useForm<AddForm>({
    resolver: zodResolver(addSchema),
    defaultValues: { email: '', role: 'member' },
  })

  /** 成员/组织数据联动刷新（成员数与角色影响组织详情与列表） */
  const refreshOrgData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: orgMembersQueryKey(orgId ?? 0, email) }),
      queryClient.invalidateQueries({ queryKey: orgQueryKey(orgId ?? 0) }),
      queryClient.invalidateQueries({ queryKey: MY_ORGS_QUERY_KEY }),
    ])
  }

  const addMutation = useMutation({
    mutationFn: (values: AddForm) => organizationApi.addMember(orgId!, values),
    onSuccess: async () => {
      await refreshOrgData()
      resetAdd()
      setShowAddForm(false)
    },
    onError: (error) => setApiError(errorMessage(error)),
  })

  const roleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: number; role: OrgRole }) =>
      organizationApi.updateMember(orgId!, userId, { role }),
    onSuccess: refreshOrgData,
    onError: (error) => setApiError(errorMessage(error)),
  })

  const removeMutation = useMutation({
    mutationFn: (userId: number) => organizationApi.removeMember(orgId!, userId),
    onSuccess: refreshOrgData,
    onError: (error) => setApiError(errorMessage(error)),
  })

  const leaveMutation = useMutation({
    mutationFn: () => organizationApi.leave(orgId!),
    onSuccess: refreshOrgData,
    onError: (error) => setApiError(errorMessage(error)),
  })

  if (orgId == null || Number.isNaN(orgId)) {
    return <p className="text-sm text-neutral-500">组织参数无效</p>
  }

  const onAdd = handleAddSubmit((values) => {
    setApiError('')
    addMutation.mutate(values)
  })

  const handleRoleChange = (userId: number, role: OrgRole) => {
    setApiError('')
    roleMutation.mutate({ userId, role })
  }

  const handleRemove = (userId: number, username: string) => {
    setApiError('')
    if (window.confirm(`确定将 ${username} 移出组织？`)) {
      removeMutation.mutate(userId)
    }
  }

  const handleLeave = () => {
    setApiError('')
    if (window.confirm('确定退出该组织？')) {
      leaveMutation.mutate()
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-neutral-900">成员管理</h2>
          <p className="mt-1 text-sm text-neutral-500">
            {org ? `${org.name} · ${org.member_count} 名成员` : '加载中…'}
          </p>
        </div>
        {canManage ? (
          <button
            type="button"
            onClick={() => setShowAddForm((v) => !v)}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700"
          >
            {showAddForm ? '收起' : '添加成员'}
          </button>
        ) : null}
      </div>

      {showAddForm && canManage ? (
        <form
          onSubmit={onAdd}
          noValidate
          className="mt-6 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm"
        >
          <h3 className="text-sm font-semibold text-neutral-900">添加已注册用户</h3>
          <div className="mt-4 flex items-end gap-3">
            <div className="flex-1">
              <TextField
                label="邮箱"
                type="email"
                placeholder="user@example.com"
                error={addErrors.email?.message}
                {...registerAdd('email')}
              />
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="add-role" className="text-sm font-medium text-neutral-700">
                角色
              </label>
              <select
                id="add-role"
                {...registerAdd('role')}
                className="rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              >
                {ASSIGNABLE_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {ORG_ROLE_LABELS[role]}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              disabled={addMutation.isPending}
              className="shrink-0 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {addMutation.isPending ? '添加中…' : '添加'}
            </button>
          </div>
        </form>
      ) : null}

      {apiError ? <p className="mt-4 text-sm text-red-500">{apiError}</p> : null}

      <div className="mt-6 max-w-sm">
        <TextField
          label="搜索成员"
          type="search"
          placeholder="按邮箱模糊搜索"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      <div className="mt-4 overflow-x-auto rounded-2xl border border-neutral-200 bg-white shadow-sm">
        {isPending ? (
          <p className="p-6 text-sm text-neutral-500">加载中…</p>
        ) : members && members.length > 0 ? (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-neutral-100 text-xs text-neutral-400">
              <tr>
                <th className="px-4 py-3 font-medium">成员</th>
                <th className="px-4 py-3 font-medium">角色</th>
                <th className="px-4 py-3 font-medium">加入时间</th>
                <th className="px-4 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const isSelf = m.user_id === me?.id
                const assignable = canAssignRole(myRole, m.role, isSelf)
                const removable = canRemove(myRole, m.role, isSelf)
                const leavable = isSelf && m.role !== 'owner'
                return (
                  <tr key={m.user_id} className="border-b border-neutral-50 last:border-0">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-medium text-indigo-700">
                          {(m.username || m.email).slice(0, 1).toUpperCase()}
                        </span>
                        <div>
                          <p className="font-medium text-neutral-900">
                            {m.username}
                            {isSelf ? <span className="ml-1 text-xs text-neutral-400">（我）</span> : null}
                          </p>
                          <p className="text-xs text-neutral-400">{m.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {assignable ? (
                        <select
                          value={m.role}
                          onChange={(e) => handleRoleChange(m.user_id, e.target.value as AssignableRole)}
                          className="rounded-lg border border-neutral-300 px-2 py-1 text-sm text-neutral-900 outline-none transition focus:border-indigo-500"
                        >
                          {(myRole === 'owner'
                            ? (['admin', 'member', 'viewer'] as const)
                            : (['member', 'viewer'] as const)
                          ).map((role) => (
                            <option key={role} value={role}>
                              {ORG_ROLE_LABELS[role]}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="rounded-full bg-indigo-50 px-3 py-0.5 text-xs font-medium text-indigo-700">
                          {ORG_ROLE_LABELS[m.role]}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-neutral-500">
                      {new Date(m.joined_at).toLocaleDateString('zh-CN')}
                    </td>
                    <td className="px-4 py-3">
                      {removable ? (
                        <button
                          type="button"
                          onClick={() => handleRemove(m.user_id, m.username)}
                          className="rounded-lg border border-red-200 px-3 py-1 text-xs text-red-600 transition hover:bg-red-50"
                        >
                          移除
                        </button>
                      ) : null}
                      {leavable ? (
                        <button
                          type="button"
                          onClick={handleLeave}
                          className="rounded-lg border border-neutral-300 px-3 py-1 text-xs text-neutral-600 transition hover:bg-neutral-100"
                        >
                          退出组织
                        </button>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : (
          <p className="p-6 text-sm text-neutral-500">
            {email ? '没有匹配的成员' : '暂无成员'}
          </p>
        )}
      </div>
    </div>
  )
}