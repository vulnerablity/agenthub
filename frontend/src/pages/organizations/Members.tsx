// pages/organizations/Members.tsx
// 成员管理：搜索、添加、行内改角色、移除与退出；操作入口按角色矩阵渲染（后端为准）
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { z } from 'zod'

import { organizationApi } from '@/api'
import Icon from '@/components/Icon'
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
    return <p className="muted">组织参数无效</p>
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
      <div className="page-head">
        <div>
          <h1 className="page-title">成员管理</h1>
          <p className="page-sub">
            {org ? `${org.name} · ${org.member_count} 名成员` : '加载中…'}
          </p>
        </div>
        {canManage ? (
          <button
            type="button"
            onClick={() => setShowAddForm((v) => !v)}
            className="btn primary"
          >
            <Icon name={showAddForm ? 'x' : 'plus'} className="ic" />
            {showAddForm ? '收起' : '添加成员'}
          </button>
        ) : null}
      </div>

      {showAddForm && canManage ? (
        <form onSubmit={onAdd} noValidate className="card card-pad mt-4">
          <h3 className="card-title">
            <Icon name="users" className="ic" />
            添加已注册用户
          </h3>
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
            <div className="field">
              <label htmlFor="add-role" className="lbl">
                角色
              </label>
              <select id="add-role" className="select" {...registerAdd('role')}>
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
              className="btn primary"
            >
              {addMutation.isPending ? '添加中…' : '添加'}
            </button>
          </div>
        </form>
      ) : null}

      {apiError ? <p className="mt-4 text-[13px] text-red-500">{apiError}</p> : null}

      <div className="mt-5 max-w-sm">
        <div className="input">
          <Icon name="search" className="ic" />
          <input
            type="search"
            placeholder="按邮箱搜索成员…"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
      </div>

      <div className="table-wrap mt-4">
        {isPending ? (
          <p className="p-6 muted">加载中…</p>
        ) : members && members.length > 0 ? (
          <table className="tbl">
            <thead>
              <tr>
                <th>成员</th>
                <th>角色</th>
                <th>加入时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const isSelf = m.user_id === me?.id
                const assignable = canAssignRole(myRole, m.role, isSelf)
                const removable = canRemove(myRole, m.role, isSelf)
                const leavable = isSelf && m.role !== 'owner'
                return (
                  <tr key={m.user_id}>
                    <td>
                      <div className="flex items-center gap-3">
                        <span className={`avatar sm ${avatarTone(m.email)}`}>
                          {(m.username || m.email).slice(0, 1).toUpperCase()}
                        </span>
                        <div>
                          <p className="font-semibold">
                            {m.username}
                            {isSelf ? <span className="ml-1 text-[12px] muted">（我）</span> : null}
                          </p>
                          <p className="text-[12px] muted">{m.email}</p>
                        </div>
                      </div>
                    </td>
                    <td>
                      {assignable ? (
                        <select
                          value={m.role}
                          onChange={(e) => handleRoleChange(m.user_id, e.target.value as AssignableRole)}
                          className="select"
                          style={{ padding: '4px 8px', fontSize: '12.5px' }}
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
                        <span className={`badge ${m.role === 'owner' ? 'accent' : m.role === 'admin' ? 'info' : 'off'}`}>
                          {ORG_ROLE_LABELS[m.role]}
                        </span>
                      )}
                    </td>
                    <td className="muted">{new Date(m.joined_at).toLocaleDateString('zh-CN')}</td>
                    <td>
                      {removable ? (
                        <button
                          type="button"
                          onClick={() => handleRemove(m.user_id, m.username)}
                          className="btn xs danger-ghost"
                        >
                          移除
                        </button>
                      ) : null}
                      {leavable ? (
                        <button type="button" onClick={handleLeave} className="btn xs ghost">
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
          <div className="empty" style={{ padding: '40px 16px' }}>
            <Icon name="users" className="ic" />
            <p>{email ? '没有匹配的成员' : '暂无成员'}</p>
          </div>
        )}
      </div>
    </div>
  )
}

/** 根据邮箱稳定映射头像渐变 */
function avatarTone(email: string): string {
  let hash = 0
  for (let i = 0; i < email.length; i += 1) {
    hash = (hash * 31 + email.charCodeAt(i)) % 997
  }
  return `av-${(hash % 6) + 1}`
}
