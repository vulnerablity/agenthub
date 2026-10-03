// pages/model-providers/List.tsx
// 模型供应商列表：卡片网格（名称/类型/base_url/密钥状态/启停/模型统计）+ 新建/编辑/删除/启停入口（owner/admin）
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'

import { modelProvidersApi } from '@/api'
import Icon from '@/components/Icon'
import { canManageModelProviders } from '@/constants/agent-options'
import { providerTypeLabel } from '@/constants/model-providers'
import { errorMessage } from '@/constants/error-messages'
import { modelProviderEditPath, modelProviderNewPath } from '@/constants/routes'
import {
  modelProvidersQueryKey,
  useModelProviders,
} from '@/hooks/useModelProviders'
import { useOrg } from '@/hooks/useOrg'
import type { ModelProviderDetail } from '@/types'

/** 密钥状态徽标（D5）：set 显掩码、invalid 提示重填、empty 显免密 */
function KeyStatusBadge({ provider }: { provider: ModelProviderDetail }) {
  if (provider.key_status === 'set') {
    return (
      <span className="badge info" title="API Key 已设置">
        密钥 <span className="mono">{provider.api_key_masked ?? '已设置'}</span>
      </span>
    )
  }
  if (provider.key_status === 'invalid') {
    return <span className="badge err">密钥不可用，需重填</span>
  }
  return <span className="badge off">免密</span>
}

export default function ModelProviderList() {
  const { orgId: orgIdParam } = useParams()
  const orgId = orgIdParam ? Number(orgIdParam) : null

  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: org } = useOrg(orgId)
  const { data: providers, isPending } = useModelProviders(orgId)
  const [apiError, setApiError] = useState('')
  const canManage = canManageModelProviders(org?.my_role)

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: modelProvidersQueryKey(orgId ?? 0) })

  const deleteMutation = useMutation({
    mutationFn: (providerId: number) => modelProvidersApi.remove(providerId),
    onSuccess: () => invalidate(),
    onError: (error) => setApiError(errorMessage(error)),
  })

  const toggleMutation = useMutation({
    mutationFn: ({ providerId, enabled }: { providerId: number; enabled: boolean }) =>
      modelProvidersApi.update(providerId, { enabled }),
    onSuccess: () => invalidate(),
    onError: (error) => setApiError(errorMessage(error)),
  })

  if (orgId == null || Number.isNaN(orgId)) {
    return <p className="muted">组织参数无效</p>
  }

  const handleDelete = (providerId: number, name: string) => {
    setApiError('')
    if (window.confirm(`确定删除供应商「${name}」？其模型清单将一并删除；若已被智能体版本引用将无法删除。`)) {
      deleteMutation.mutate(providerId)
    }
  }

  return (
    <div>
      <div className="page-head">
        {/* <div>
          <h1 className="page-title">模型供应商</h1>
          <p className="page-sub">
            {org
              ? `${org.name} · 多供应商 LLM 接入（DeepSeek / 智谱 / 豆包 / Ollama 等），智能体版本按「供应商 + 模型」路由`
              : '加载中…'}
          </p>
        </div> */}
        {canManage ? (
          <button
            type="button"
            onClick={() => navigate(modelProviderNewPath(orgId))}
            className="btn primary"
          >
            <Icon name="plus" className="ic" />
            新建供应商
          </button>
        ) : null}
      </div>

      {apiError ? <p className="mt-4 text-[13px] text-red-500">{apiError}</p> : null}

      {isPending ? (
        <p className="mt-6 muted">加载中…</p>
      ) : providers && providers.length > 0 ? (
        <ul className="grid g2 mt-6 xl:grid-cols-3">
          {providers.map((provider) => (
            <li key={provider.id} className="card card-pad flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <span className="avatar md av-3">
                  <Icon name="layers" width={16} height={16} />
                </span>
                <h3 className="truncate text-[15px] font-bold">{provider.name}</h3>
                <span className="badge accent">{providerTypeLabel(provider.provider_type)}</span>
                {provider.enabled ? (
                  <span className="badge ok">已启用</span>
                ) : (
                  <span className="badge off">已停用</span>
                )}
              </div>
              <p className="text-[12px] muted">
                <span className="mono break-all">{provider.base_url}</span>
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <KeyStatusBadge provider={provider} />
                <span className="text-[12px] muted">
                  {provider.models.length} 个模型 · 启用{' '}
                  {provider.models.filter((m) => m.enabled).length} 个
                </span>
              </div>
              {provider.key_status === 'invalid' ? (
                <p className="text-[12px] text-red-500">
                  已存密钥不可解密，请重新录入 API Key（停用/删除不受影响）
                </p>
              ) : null}
              <p className="text-[12px] muted">
                创建于 {new Date(provider.created_at).toLocaleDateString('zh-CN')}
              </p>
              <div className="row-actions mt-1">
                {canManage ? (
                  <>
                    <button
                      type="button"
                      onClick={() => navigate(modelProviderEditPath(orgId, provider.id))}
                      className="btn primary xs"
                    >
                      编辑
                    </button>
                    <button
                      type="button"
                      disabled={toggleMutation.isPending && toggleMutation.variables?.providerId === provider.id}
                      onClick={() =>
                        toggleMutation.mutate({
                          providerId: provider.id,
                          enabled: !provider.enabled,
                        })
                      }
                      className="btn ghost xs"
                    >
                      {provider.enabled ? '停用' : '启用'}
                    </button>
                    <button
                      type="button"
                      disabled={
                        deleteMutation.isPending && deleteMutation.variables === provider.id
                      }
                      onClick={() => handleDelete(provider.id, provider.name)}
                      className="btn xs danger-ghost ml-auto"
                    >
                      {deleteMutation.isPending && deleteMutation.variables === provider.id
                        ? '删除中…'
                        : '删除'}
                    </button>
                  </>
                ) : (
                  <span className="text-[12px] muted">仅组织所有者/管理员可管理</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="empty mt-6">
          <Icon name="layers" className="ic" />
          <p>
            {canManage
              ? '尚未接入模型供应商，点击右上角「新建供应商」配置 LLM 接入'
              : '该组织暂无模型供应商'}
          </p>
          {canManage ? (
            <div className="actions">
              <button
                type="button"
                onClick={() => navigate(modelProviderNewPath(orgId))}
                className="btn primary sm"
              >
                <Icon name="plus" className="ic" />
                新建供应商
              </button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
