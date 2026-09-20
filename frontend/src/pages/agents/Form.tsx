// pages/agents/Form.tsx
// 智能体创建/编辑共用表单：创建态 = 基础信息 + 初始模型配置 + 提示词（自动生成 v1）；
// 编辑态仅基础信息（名称/描述/头像），模型与提示词变更走版本页（需求 3.3/3.4）
import { useEffect, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { z } from 'zod'

import { agentApi } from '@/api'
import TextField from '@/components/form/TextField'
import { AGENT_STATUS_LABELS, PROVIDER_OPTIONS, canManageAgent } from '@/constants/agent-options'
import { errorMessage } from '@/constants/error-messages'
import { agentDetailPath, agentsPath } from '@/constants/routes'
import { useAgent } from '@/hooks/useAgent'
import { useOrg } from '@/hooks/useOrg'
import type { AgentCreateRequest, AgentUpdateRequest } from '@/types'

// temperature / max_tokens 以字符串承载：空串表示「运行时默认」，与后端 null 语义对齐
// 模型配置必填仅创建态生效（onSubmit 内 setError 判定，编辑态不展示这些字段）
const agentSchema = z.object({
  name: z.string().min(1, '请输入智能体名称').max(100, '名称最多 100 个字符'),
  description: z.string().max(5000, '描述最多 5000 个字符'),
  avatarUrl: z.string().max(500, '头像地址最多 500 个字符'),
  status: z.enum(['enabled', 'disabled']),
  provider: z.string().max(50, '提供方最多 50 个字符'),
  modelName: z.string().max(100, '模型名最多 100 个字符'),
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

type AgentForm = z.infer<typeof agentSchema>

const EMPTY_FORM: AgentForm = {
  name: '',
  description: '',
  avatarUrl: '',
  status: 'enabled',
  provider: '',
  modelName: '',
  temperature: '',
  maxTokens: '',
  systemPrompt: '',
}

function buildCreatePayload(values: AgentForm): AgentCreateRequest {
  return {
    name: values.name,
    description: values.description.trim() ? values.description.trim() : null,
    avatar_url: values.avatarUrl.trim() ? values.avatarUrl.trim() : null,
    status: values.status,
    system_prompt: values.systemPrompt,
    model_provider: values.provider.trim(),
    model_name: values.modelName.trim(),
    temperature: values.temperature === '' ? null : Number(values.temperature),
    max_tokens: values.maxTokens === '' ? null : Number(values.maxTokens),
  }
}

function buildUpdatePayload(values: AgentForm): AgentUpdateRequest {
  return {
    name: values.name,
    description: values.description.trim() ? values.description.trim() : null,
    avatar_url: values.avatarUrl.trim() ? values.avatarUrl.trim() : null,
  }
}

export default function AgentForm() {
  const { orgId: orgIdParam, agentId: agentIdParam } = useParams()
  const orgId = orgIdParam ? Number(orgIdParam) : null
  const agentId = agentIdParam ? Number(agentIdParam) : null
  const isEdit = agentId != null

  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: org } = useOrg(orgId)
  const { data: agent } = useAgent(orgId, agentId, isEdit)
  const canManage = canManageAgent(org?.my_role)
  const [apiError, setApiError] = useState('')

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    setError,
    control,
    formState: { errors },
  } = useForm<AgentForm>({
    resolver: zodResolver(agentSchema),
    defaultValues: EMPTY_FORM,
  })

  // 创建态实时预览（编辑态不渲染预览面板）
  const preview = useWatch({ control })

  // 编辑态：详情到达后回填基础信息
  useEffect(() => {
    if (isEdit && agent) {
      reset({
        ...EMPTY_FORM,
        name: agent.name,
        description: agent.description ?? '',
        avatarUrl: agent.avatar_url ?? '',
        status: agent.status,
      })
    }
  }, [agent, isEdit, reset])

  const submitMutation = useMutation({
    mutationFn: (values: AgentForm) =>
      isEdit ? agentApi.update(agentId!, buildUpdatePayload(values)) : agentApi.create(buildCreatePayload(values)),
    onSuccess: async ({ data }) => {
      await queryClient.invalidateQueries({ queryKey: ['org', orgId, 'agents'] })
      if (isEdit) {
        await queryClient.invalidateQueries({ queryKey: ['org', orgId, 'agent', agentId] })
      }
      navigate(agentDetailPath(orgId!, data.id))
    },
    onError: (error) => setApiError(errorMessage(error)),
  })

  if (orgId == null || Number.isNaN(orgId)) {
    return <p className="text-sm text-neutral-500">组织参数无效</p>
  }

  // 组织数据未到达前先展示加载态，避免管理员误见「无权限」提示
  if (org == null) {
    return <p className="text-sm text-neutral-500">加载中…</p>
  }

  if (!canManage) {
    return <p className="text-sm text-neutral-500">没有权限管理智能体</p>
  }

  // 编辑态数据未就绪时禁用提交，避免空表单覆盖
  const formReady = !isEdit || agent != null
  const cancelTo = isEdit ? agentDetailPath(orgId, agentId!) : agentsPath(orgId)

  const onSubmit = handleSubmit((values) => {
    setApiError('')
    // 仅创建态：模型配置必填（编辑态不收集这些字段）
    if (!isEdit) {
      if (!values.provider.trim()) {
        setError('provider', { message: '请输入模型提供方' })
        return
      }
      if (!values.modelName.trim()) {
        setError('modelName', { message: '请输入模型名称' })
        return
      }
    }
    submitMutation.mutate(values)
  })

  const basicSection = (
    <section className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
      <h3 className="text-base font-semibold text-neutral-900">基础信息</h3>
      <div className="mt-4 space-y-4">
        <TextField
          label="名称"
          placeholder="例如：客服助手"
          error={errors.name?.message}
          {...register('name')}
        />
        <TextField
          label="描述"
          placeholder="一句话说明智能体的用途（可选）"
          error={errors.description?.message}
          {...register('description')}
        />
        <TextField
          label="头像地址"
          placeholder="https://…（可选，留空使用首字母头像）"
          error={errors.avatarUrl?.message}
          {...register('avatarUrl')}
        />
        {!isEdit ? (
          <div className="flex flex-col gap-2">
            <label htmlFor="agent-status" className="text-sm font-medium text-neutral-700">
              状态
            </label>
            <select
              id="agent-status"
              {...register('status')}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            >
              <option value="enabled">{AGENT_STATUS_LABELS.enabled}</option>
              <option value="disabled">{AGENT_STATUS_LABELS.disabled}</option>
            </select>
          </div>
        ) : null}
      </div>
    </section>
  )

  const configSection = (
    <section className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
      <h3 className="text-base font-semibold text-neutral-900">模型配置（初始版本 v1）</h3>
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
        <div className="flex flex-col gap-2">
          <label htmlFor="agent-temperature" className="text-sm font-medium text-neutral-700">
            Temperature
          </label>
          <div className="flex items-center gap-3">
            <input
              id="agent-temperature"
              type="range"
              min={0}
              max={2}
              step={0.1}
              value={preview.temperature === '' ? '0' : preview.temperature}
              onChange={(e) => setValue('temperature', Number(e.target.value).toString())}
              className="flex-1 accent-indigo-600"
            />
            <span className="w-12 shrink-0 text-right font-mono text-sm text-neutral-700">
              {preview.temperature === '' ? '默认' : Number(preview.temperature).toFixed(1)}
            </span>
          </div>
          <p className="text-xs text-neutral-400">留空使用运行时默认（0–2）</p>
          {errors.temperature ? (
            <p className="text-xs text-red-500">{errors.temperature.message}</p>
          ) : null}
        </div>
        <TextField
          label="Max Tokens"
          type="number"
          placeholder="留空使用运行时默认"
          error={errors.maxTokens?.message}
          {...register('maxTokens')}
        />
      </div>
    </section>
  )

  const promptSection = (
    <section className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
      <h3 className="text-base font-semibold text-neutral-900">系统提示词</h3>
      <div className="mt-4 flex flex-col gap-2">
        <label htmlFor="agent-system-prompt" className="text-sm font-medium text-neutral-700">
          System Prompt
        </label>
        <textarea
          id="agent-system-prompt"
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
  )

  return (
    <div className="mx-auto max-w-6xl">
      <div>
        <h2 className="text-xl font-semibold text-neutral-900">
          {isEdit ? '编辑智能体' : '新建智能体'}
        </h2>
        <p className="mt-1 text-sm text-neutral-500">
          {org.name}
          {isEdit && agent ? ` · ${agent.name}` : ''}
        </p>
      </div>

      {apiError ? <p className="mt-4 text-sm text-red-500">{apiError}</p> : null}

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <form
          id="agent-form"
          onSubmit={onSubmit}
          noValidate
          className="space-y-6 lg:col-span-2"
        >
          {basicSection}
          {!isEdit ? (
            <>
              {configSection}
              {promptSection}
            </>
          ) : null}

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => navigate(cancelTo)}
              className="rounded-lg border border-neutral-300 px-4 py-2 text-sm text-neutral-700 transition hover:bg-neutral-100"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={submitMutation.isPending || !formReady}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitMutation.isPending ? '保存中…' : '保存'}
            </button>
          </div>
        </form>

        {!isEdit ? (
          <aside className="self-start lg:sticky lg:top-8">
            <div className="rounded-2xl border border-indigo-100 bg-indigo-50/50 p-5 shadow-sm">
              <h3 className="text-xs font-medium text-neutral-400">实时预览</h3>
              <div className="mt-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-semibold text-neutral-900">
                    {preview.name || '未命名智能体'}
                  </p>
                  <span
                    className={`shrink-0 rounded-full px-3 py-0.5 text-xs font-medium ${
                      preview.status === 'enabled'
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-neutral-100 text-neutral-500'
                    }`}
                  >
                    {AGENT_STATUS_LABELS[preview.status ?? 'enabled']}
                  </span>
                </div>
                <p className="mt-2 line-clamp-2 min-h-8 text-xs text-neutral-500">
                  {preview.description || '暂无描述'}
                </p>
                {preview.provider || preview.modelName ? (
                  <p className="mt-3 text-xs text-neutral-400">
                    <span className="rounded bg-neutral-100 px-2 py-0.5 font-mono">
                      {preview.provider || 'provider'}
                    </span>
                    <span className="mx-1.5">/</span>
                    <span className="rounded bg-neutral-100 px-2 py-0.5 font-mono">
                      {preview.modelName || 'model'}
                    </span>
                  </p>
                ) : null}
                <dl className="mt-3 space-y-1 border-t border-neutral-100 pt-3 text-xs text-neutral-500">
                  <div className="flex justify-between">
                    <dt>温度</dt>
                    <dd className="font-mono">
                      {preview.temperature === '' ? '默认' : Number(preview.temperature).toFixed(1)}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>Max Tokens</dt>
                    <dd className="font-mono">{preview.maxTokens || '默认'}</dd>
                  </div>
                </dl>
              </div>
              <p className="mt-3 text-xs text-neutral-400">
                提示词 {(preview.systemPrompt ?? '').length} 字符
              </p>
              <button
                type="submit"
                form="agent-form"
                disabled={submitMutation.isPending || !formReady}
                className="mt-4 hidden w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60 lg:block"
              >
                {submitMutation.isPending ? '保存中…' : '保存智能体'}
              </button>
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  )
}