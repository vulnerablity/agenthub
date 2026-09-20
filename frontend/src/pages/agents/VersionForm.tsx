// pages/agents/VersionForm.tsx
// 新建版本表单：基于当前版本预填模型配置与提示词，提交仅创建版本（发布在详情页手动进行，需求 3.4）
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { z } from 'zod'

import { agentApi } from '@/api'
import TextField from '@/components/form/TextField'
import { PROVIDER_OPTIONS, canManageAgent } from '@/constants/agent-options'
import { errorMessage } from '@/constants/error-messages'
import { agentDetailPath } from '@/constants/routes'
import { useAgent } from '@/hooks/useAgent'
import { useOrg } from '@/hooks/useOrg'
import type { AgentVersionCreateRequest } from '@/types'

const versionSchema = z.object({
  provider: z.string().min(1, '请输入模型提供方').max(50, '提供方最多 50 个字符'),
  modelName: z.string().min(1, '请输入模型名称').max(100, '模型名最多 100 个字符'),
  temperature: z
    .string()
    .refine(
      (v) => v === '' || (!Number.isNaN(Number(v)) && Number(v) >= 0 && Number(v) <= 2),
      '温度需在 0–2 之间',
    ),
  maxTokens: z
    .string()
    .refine(
      (v) =>
        v === '' ||
        (Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 100000),
      '最大 token 数需为 1–100000 的整数',
    ),
  systemPrompt: z.string().max(10000, '系统提示词最多 10000 个字符'),
})

type VersionForm = z.infer<typeof versionSchema>

const EMPTY_FORM: VersionForm = {
  provider: '',
  modelName: '',
  temperature: '',
  maxTokens: '',
  systemPrompt: '',
}

function buildPayload(values: VersionForm): AgentVersionCreateRequest {
  return {
    model_provider: values.provider.trim(),
    model_name: values.modelName.trim(),
    temperature: values.temperature === '' ? null : Number(values.temperature),
    max_tokens: values.maxTokens === '' ? null : Number(values.maxTokens),
    system_prompt: values.systemPrompt,
  }
}

export default function VersionForm() {
  const { orgId: orgIdParam, agentId: agentIdParam } = useParams()
  const orgId = orgIdParam ? Number(orgIdParam) : null
  const agentId = agentIdParam ? Number(agentIdParam) : null

  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: org } = useOrg(orgId)
  const { data: agent } = useAgent(orgId, agentId)
  const canManage = canManageAgent(org?.my_role)
  const [apiError, setApiError] = useState('')

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<VersionForm>({
    resolver: zodResolver(versionSchema),
    defaultValues: EMPTY_FORM,
  })

  // 基于当前版本预填，便于在现有配置上微调
  useEffect(() => {
    const current = agent?.current_version_detail
    if (current) {
      reset({
        provider: current.model_provider,
        modelName: current.model_name,
        temperature: current.temperature != null ? String(current.temperature) : '',
        maxTokens: current.max_tokens != null ? String(current.max_tokens) : '',
        systemPrompt: current.system_prompt,
      })
    }
  }, [agent, reset])

  const submitMutation = useMutation({
    mutationFn: (values: VersionForm) =>
      agentApi.createVersion(agentId!, buildPayload(values)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['org', orgId, 'agent', agentId, 'versions'],
      })
      await queryClient.invalidateQueries({ queryKey: ['org', orgId, 'agent', agentId] })
      navigate(agentDetailPath(orgId!, agentId!))
    },
    onError: (error) => setApiError(errorMessage(error)),
  })

  if (orgId == null || agentId == null || Number.isNaN(orgId) || Number.isNaN(agentId)) {
    return <p className="text-sm text-neutral-500">参数无效</p>
  }

  if (org == null) {
    return <p className="text-sm text-neutral-500">加载中…</p>
  }

  if (!canManage) {
    return <p className="text-sm text-neutral-500">没有权限管理智能体</p>
  }

  const onSubmit = handleSubmit((values) => {
    setApiError('')
    submitMutation.mutate(values)
  })

  return (
    <div className="mx-auto max-w-2xl">
      <div>
        <h2 className="text-xl font-semibold text-neutral-900">新建版本</h2>
        <p className="mt-1 text-sm text-neutral-500">
          {agent ? `${agent.name} · 基于当前版本预填，创建后需在详情页发布` : '加载中…'}
        </p>
      </div>

      {apiError ? <p className="mt-4 text-sm text-red-500">{apiError}</p> : null}

      <form onSubmit={onSubmit} noValidate className="mt-6 space-y-6">
        <section className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
          <h3 className="text-base font-semibold text-neutral-900">模型配置</h3>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <TextField
                label="LLM Provider"
                placeholder="例如：openai"
                list="provider-options"
                error={errors.provider?.message}
                {...register('provider')}
              />
              <datalist id="provider-options">
                {PROVIDER_OPTIONS.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </div>
            <TextField
              label="模型"
              placeholder="例如：gpt-4o-mini"
              error={errors.modelName?.message}
              {...register('modelName')}
            />
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextField
              label="Temperature"
              type="number"
              step="0.1"
              placeholder="留空使用运行时默认（0–2）"
              error={errors.temperature?.message}
              {...register('temperature')}
            />
            <TextField
              label="Max Tokens"
              type="number"
              placeholder="留空使用运行时默认"
              error={errors.maxTokens?.message}
              {...register('maxTokens')}
            />
          </div>
        </section>

        <section className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
          <h3 className="text-base font-semibold text-neutral-900">系统提示词</h3>
          <div className="mt-4 flex flex-col gap-2">
            <label htmlFor="version-system-prompt" className="text-sm font-medium text-neutral-700">
              System Prompt
            </label>
            <textarea
              id="version-system-prompt"
              rows={10}
              placeholder="定义智能体的角色、行为与回答风格…"
              className={`w-full resize-y rounded-lg border px-3 py-2 font-mono text-sm text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:ring-2 ${
                errors.systemPrompt
                  ? 'border-red-400 focus:border-red-500 focus:ring-red-100'
                  : 'border-neutral-300 focus:border-indigo-500 focus:ring-indigo-100'
              }`}
              {...register('systemPrompt')}
            />
            {errors.systemPrompt ? (
              <p className="text-xs text-red-500">{errors.systemPrompt.message}</p>
            ) : null}
          </div>
        </section>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(agentDetailPath(orgId, agentId))}
            className="rounded-lg border border-neutral-300 px-4 py-2 text-sm text-neutral-700 transition hover:bg-neutral-100"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={submitMutation.isPending}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitMutation.isPending ? '创建中…' : '创建版本'}
          </button>
        </div>
      </form>
    </div>
  )
}