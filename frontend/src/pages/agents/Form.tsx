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
import Icon from '@/components/Icon'
import TextField from '@/components/form/TextField'
import { AGENT_STATUS_LABELS, PROVIDER_OPTIONS, canManageAgent } from '@/constants/agent-options'
import { errorMessage } from '@/constants/error-messages'
import { agentDetailPath, agentsPath } from '@/constants/routes'
import { useAgent } from '@/hooks/useAgent'
import { useModelProviders } from '@/hooks/useModelProviders'
import { useOrg } from '@/hooks/useOrg'
import type { AgentCreateRequest, AgentUpdateRequest, ModelProviderDetail } from '@/types'

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

/** 模型下拉「自定义模型」哨兵值：选中后切入手动输入（未登记模型放行，按默认能力处理 D4/D12） */
const CUSTOM_MODEL = '__custom__'

function buildCreatePayload(
  values: AgentForm,
  selectedProvider: ModelProviderDetail | null,
): AgentCreateRequest {
  return {
    name: values.name,
    description: values.description.trim() ? values.description.trim() : null,
    avatar_url: values.avatarUrl.trim() ? values.avatarUrl.trim() : null,
    status: values.status,
    system_prompt: values.systemPrompt,
    // 选中供应商时传名称快照（服务端按 D3 亦会以 provider.name 赋值）；全局默认保留自由输入
    model_provider: selectedProvider ? selectedProvider.name : values.provider.trim(),
    model_name: values.modelName.trim(),
    // 路由真源（D2）：全局默认 = 不传 provider_id（走 LLM_API_BASE，旧数据零迁移兼容）
    provider_id: selectedProvider ? selectedProvider.id : undefined,
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
  // 供应商列表（D10 全成员可读）：两级下拉第一级（model-providers.md §9）
  const { data: providers } = useModelProviders(orgId)
  const canManage = canManageAgent(org?.my_role)
  const [apiError, setApiError] = useState('')
  // 两级模型选择（model-providers.md §9）：null = 全局默认（不绑定）
  const [providerId, setProviderId] = useState<number | null>(null)
  // 第二级选中项：model_key / CUSTOM_MODEL（自定义输入）；全局默认下不使用
  const [modelKey, setModelKey] = useState('')

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

  // 当前选中的供应商（null = 全局默认）：提交时决定 provider_id 与 model_provider 快照
  const selectedProvider =
    providerId != null ? (providers?.find((p) => p.id === providerId) ?? null) : null
  // 两级模型选择（model-providers.md §9）：第二级只列出启用模型
  const enabledModels = selectedProvider?.models.filter((m) => m.enabled) ?? []

  const handleProviderChange = (raw: string) => {
    if (raw === '') {
      // 全局默认：model_provider/model_name 保持自由输入（保留旧快照文本可继续编辑）
      setProviderId(null)
      setModelKey('')
      return
    }
    const provider = providers?.find((p) => p.id === Number(raw))
    if (!provider) return
    setProviderId(provider.id)
    setModelKey(provider.models.some((m) => m.enabled) ? '' : CUSTOM_MODEL)
    // 选中供应商时 model_provider 写入名称快照（服务端按 D3/D12 亦会赋值）
    setValue('provider', provider.name)
    setValue('modelName', '')
  }

  const handleModelChange = (key: string) => {
    setModelKey(key)
    // 登记模型直接回填 model_name；自定义模型清空待输入
    setValue('modelName', key === CUSTOM_MODEL ? '' : key)
  }

  const submitMutation = useMutation({
    mutationFn: (values: AgentForm) =>
      isEdit
        ? agentApi.update(agentId!, buildUpdatePayload(values))
        : agentApi.create(buildCreatePayload(values, selectedProvider)),
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
    return <p className="muted">组织参数无效</p>
  }

  // 组织数据未到达前先展示加载态，避免管理员误见「无权限」提示
  if (org == null) {
    return <p className="muted">加载中…</p>
  }

  if (!canManage) {
    return <p className="muted">没有权限管理智能体</p>
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

  const sectionCls = 'card card-pad'
  const sectionTitleCls = 'card-title'

  return (
    <div className="mx-auto max-w-5xl">
      <div className="page-head">
        <div>
          <h1 className="page-title">{isEdit ? '编辑智能体' : '新建智能体'}</h1>
          <p className="page-sub">
            {org.name}
            {isEdit && agent ? ` · ${agent.name}` : ''}
          </p>
        </div>
      </div>

      {apiError ? <p className="mt-4 text-[13px] text-red-500">{apiError}</p> : null}

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <form id="agent-form" onSubmit={onSubmit} noValidate className="flex flex-col gap-5 lg:col-span-2">
          <section className={sectionCls}>
            <h3 className={sectionTitleCls}>
              <Icon name="bot" className="ic" />
              基础信息
            </h3>
            <div className="mt-4 flex flex-col gap-4">
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
                <div className="field">
                  <label htmlFor="agent-status" className="lbl">
                    状态
                  </label>
                  <select id="agent-status" className="select w-full" {...register('status')}>
                    <option value="enabled">{AGENT_STATUS_LABELS.enabled}</option>
                    <option value="disabled">{AGENT_STATUS_LABELS.disabled}</option>
                  </select>
                </div>
              ) : null}
            </div>
          </section>

          {!isEdit ? (
            <>
              <section className={sectionCls}>
                <h3 className={sectionTitleCls}>
                  <Icon name="cpu" className="ic" />
                  模型配置（初始版本 v1）
                </h3>
                <div className="mt-4 grid g2">
                  <div className="field">
                    <label htmlFor="agent-provider-select" className="lbl">
                      模型供应商
                    </label>
                    <select
                      id="agent-provider-select"
                      className="select w-full"
                      value={providerId ?? ''}
                      onChange={(e) => handleProviderChange(e.target.value)}
                    >
                      <option value="">全局默认（不绑定）</option>
                      {providers?.map((p) => (
                        <option key={p.id} value={p.id} disabled={!p.enabled}>
                          {p.name}
                          {p.enabled ? '' : '（已停用）'}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1.5 text-[12px] muted">
                      全局默认沿用平台 LLM_API_BASE 配置；选择供应商后从其启用模型中选取
                    </p>
                  </div>
                  <div>
                    <TextField
                      label="LLM Provider"
                      placeholder="例如：openai"
                      list="provider-options"
                      readOnly={selectedProvider != null}
                      error={errors.provider?.message}
                      {...register('provider')}
                    />
                    <datalist id="provider-options">
                      {PROVIDER_OPTIONS.map((p) => (
                        <option key={p} value={p} />
                      ))}
                    </datalist>
                    {selectedProvider != null ? (
                      <p className="mt-1.5 text-[12px] muted">
                        已绑定供应商，此处为名称快照（随版本保存，不随后续改名回写）
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="mt-4 grid g2">
                  {selectedProvider == null ? (
                    <TextField
                      label="模型"
                      placeholder="例如：gpt-4o-mini"
                      error={errors.modelName?.message}
                      {...register('modelName')}
                    />
                  ) : modelKey === CUSTOM_MODEL ? (
                    <div>
                      <TextField
                        label="模型名称（自定义）"
                        placeholder="输入供应商支持的模型标识"
                        error={errors.modelName?.message}
                        {...register('modelName')}
                      />
                      {/* 自定义模型旁注（D4/D12）：未登记模型放行，按默认能力处理 */}
                      <p className="mt-1.5 text-[12px] text-amber-600">
                        未登记模型按默认能力处理：工具调用开、流式用量开、思考模式关
                      </p>
                    </div>
                  ) : (
                    <div className="field">
                      <label htmlFor="agent-model-select" className="lbl">
                        模型（已启用）
                      </label>
                      <select
                        id="agent-model-select"
                        className="select w-full"
                        value={modelKey}
                        onChange={(e) => handleModelChange(e.target.value)}
                      >
                        <option value="" disabled>
                          请选择模型
                        </option>
                        {enabledModels.map((m) => (
                          <option key={m.id} value={m.model_key}>
                            {m.display_name}（{m.model_key}）
                          </option>
                        ))}
                        <option value={CUSTOM_MODEL}>自定义模型（手动输入）</option>
                      </select>
                      {enabledModels.length === 0 ? (
                        <p className="mt-1.5 text-[12px] muted">
                          该供应商暂无启用模型，请改选「自定义模型」手动输入
                        </p>
                      ) : null}
                    </div>
                  )}
                  <div className="field">
                    <label htmlFor="agent-temperature" className="lbl">
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
                        className="flex-1 accent-[#5b5bd6]"
                      />
                      <span className="w-12 shrink-0 text-right mono text-[13px]">
                        {preview.temperature === '' ? '默认' : Number(preview.temperature).toFixed(1)}
                      </span>
                    </div>
                    <p className="mt-1 text-[12px] muted">留空使用运行时默认（0–2）</p>
                    {errors.temperature ? (
                      <p className="err-text">{errors.temperature.message}</p>
                    ) : null}
                  </div>
                </div>
                <div className="mt-4 grid g2">
                  <TextField
                    label="Max Tokens"
                    type="number"
                    placeholder="留空使用运行时默认"
                    error={errors.maxTokens?.message}
                    {...register('maxTokens')}
                  />
                </div>
              </section>

              <section className={sectionCls}>
                <h3 className={sectionTitleCls}>
                  <Icon name="file-text" className="ic" />
                  系统提示词
                </h3>
                <div className="field mt-4">
                  <label htmlFor="agent-system-prompt" className="lbl">
                    System Prompt
                  </label>
                  <textarea
                    id="agent-system-prompt"
                    rows={10}
                    placeholder="定义智能体的角色、行为与回答风格…"
                    className={`w-full resize-y rounded-[10px] border px-3.5 py-2.5 mono leading-relaxed outline-none transition placeholder:text-[#b3b9ce] ${
                      errors.systemPrompt
                        ? 'border-[#f5c6c6] focus:border-[#dc2626] focus:ring-2 focus:ring-[#fdecec]'
                        : 'border-[var(--line-2)] focus:border-[var(--accent)] focus:ring-2 focus:ring-[#e4e6ff]'
                    }`}
                    {...register('systemPrompt')}
                  />
                  {errors.systemPrompt ? (
                    <p className="err-text">{errors.systemPrompt.message}</p>
                  ) : null}
                </div>
              </section>
            </>
          ) : null}

          <div className="row-actions">
            <button
              type="button"
              onClick={() => navigate(cancelTo)}
              className="btn ghost"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={submitMutation.isPending || !formReady}
              className="btn primary"
            >
              {submitMutation.isPending ? '保存中…' : '保存'}
            </button>
          </div>
        </form>

        {!isEdit ? (
          <aside className="self-start lg:sticky lg:top-6">
            <div
              className="card card-pad"
              style={{ background: 'linear-gradient(160deg, #f3f0ff, #f7f8ff)', borderColor: '#e0dcff' }}
            >
              <h3 className="text-[12px] font-semibold uppercase tracking-wide muted">实时预览</h3>
              <div className="card card-pad mt-3" style={{ padding: '16px' }}>
                <div className="flex-between">
                  <p className="truncate text-[14px] font-bold">{preview.name || '未命名智能体'}</p>
                  <span className={`badge ${preview.status === 'enabled' ? 'ok' : 'off'}`}>
                    {AGENT_STATUS_LABELS[preview.status ?? 'enabled']}
                  </span>
                </div>
                <p className="mt-2 line-clamp-2 min-h-8 text-[12.5px] muted">
                  {preview.description || '暂无描述'}
                </p>
                {preview.provider || preview.modelName ? (
                  <p className="mt-3">
                    <span className="tag">{preview.provider || 'provider'}</span>
                    <span className="mx-1.5 muted">/</span>
                    <span className="tag">{preview.modelName || 'model'}</span>
                  </p>
                ) : null}
                <dl className="kv mt-3">
                  <div className="row flex justify-between">
                    <dt>温度</dt>
                    <dd className="mono">
                      {preview.temperature === '' ? '默认' : Number(preview.temperature).toFixed(1)}
                    </dd>
                  </div>
                  <div className="row flex justify-between">
                    <dt>Max Tokens</dt>
                    <dd className="mono">{preview.maxTokens || '默认'}</dd>
                  </div>
                </dl>
              </div>
              <p className="mt-3 text-[12px] muted">
                提示词 {(preview.systemPrompt ?? '').length} 字符
              </p>
              <button
                type="submit"
                form="agent-form"
                disabled={submitMutation.isPending || !formReady}
                className="btn primary mt-3 hidden w-full lg:block"
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
