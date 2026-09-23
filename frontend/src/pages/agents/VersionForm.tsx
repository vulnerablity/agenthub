// pages/agents/VersionForm.tsx
// 新建版本表单：基于当前版本预填模型配置与提示词，提交仅创建版本（发布在详情页手动进行，需求 3.4）
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { z } from 'zod'

import { agentApi } from '@/api'
import Icon from '@/components/Icon'
import TextField from '@/components/form/TextField'
import { PROVIDER_OPTIONS, canManageAgent } from '@/constants/agent-options'
import { errorMessage } from '@/constants/error-messages'
import { agentDetailPath } from '@/constants/routes'
import { useAgent } from '@/hooks/useAgent'
import { useKnowledgeBases } from '@/hooks/useKnowledgeBases'
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

function buildPayload(
  values: VersionForm,
  configJson: Record<string, unknown> | null,
): AgentVersionCreateRequest {
  return {
    model_provider: values.provider.trim(),
    model_name: values.modelName.trim(),
    temperature: values.temperature === '' ? null : Number(values.temperature),
    max_tokens: values.maxTokens === '' ? null : Number(values.maxTokens),
    system_prompt: values.systemPrompt,
    config_json: configJson,
  }
}

/** 从版本 config_json 中读取 rag 绑定（兼容缺失/异常结构，knowledge.md D11） */
function readRagBinding(configJson: Record<string, unknown> | null | undefined): {
  kbIds: number[]
  topK: number
} {
  const raw = configJson?.rag
  if (raw == null || typeof raw !== 'object') {
    return { kbIds: [], topK: 5 }
  }
  const rag = raw as { knowledge_base_ids?: unknown; rag_top_k?: unknown }
  const kbIds = Array.isArray(rag.knowledge_base_ids)
    ? rag.knowledge_base_ids.filter((v): v is number => typeof v === 'number')
    : []
  const topK = typeof rag.rag_top_k === 'number' ? rag.rag_top_k : 5
  return { kbIds, topK }
}

export default function VersionForm() {
  const { orgId: orgIdParam, agentId: agentIdParam } = useParams()
  const orgId = orgIdParam ? Number(orgIdParam) : null
  const agentId = agentIdParam ? Number(agentIdParam) : null

  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: org } = useOrg(orgId)
  const { data: agent } = useAgent(orgId, agentId)
  const { data: kbList } = useKnowledgeBases(orgId)
  const canManage = canManageAgent(org?.my_role)
  const [apiError, setApiError] = useState('')
  // RAG 绑定（knowledge.md D11）：随版本快照保存，合并进 config_json 而非覆盖其它键
  const [selectedKbIds, setSelectedKbIds] = useState<number[]>([])
  const [ragTopK, setRagTopK] = useState(5)
  // 上次已预填的版本 id：RAG 绑定数据加载后于渲染期同步预填（官方 adjust-state-during-render
  // 模式，避免 effect 内 setState 的连锁渲染，react-hooks/set-state-in-effect）
  const [loadedVersionId, setLoadedVersionId] = useState<number | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<VersionForm>({
    resolver: zodResolver(versionSchema),
    defaultValues: EMPTY_FORM,
  })

  // 基于当前版本预填（react-hook-form 的 reset 属库级表单更新，非 React setState）
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

  // 渲染期同步 RAG 绑定预填（与上方表单 reset 同源触发，不在 effect 内 setState）
  const currentVersion = agent?.current_version_detail
  if (currentVersion && loadedVersionId !== currentVersion.id) {
    setLoadedVersionId(currentVersion.id)
    const binding = readRagBinding(currentVersion.config_json)
    setSelectedKbIds(binding.kbIds)
    setRagTopK(binding.topK)
  }

  const submitMutation = useMutation({
    mutationFn: (values: VersionForm) =>
      agentApi.createVersion(agentId!, {
        ...buildPayload(values, {
          // 合并原版本其它配置键，仅更新 rag（不覆盖自定义扩展字段，knowledge.md D11）
          ...(agent?.current_version_detail?.config_json ?? {}),
          rag: { knowledge_base_ids: selectedKbIds, rag_top_k: ragTopK },
        }),
      }),
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
    return <p className="muted">参数无效</p>
  }

  if (org == null) {
    return <p className="muted">加载中…</p>
  }

  if (!canManage) {
    return <p className="muted">没有权限管理智能体</p>
  }

  const onSubmit = handleSubmit((values) => {
    setApiError('')
    submitMutation.mutate(values)
  })

  const toggleKb = (kbId: number) => {
    setSelectedKbIds((prev) =>
      prev.includes(kbId) ? prev.filter((id) => id !== kbId) : [...prev, kbId],
    )
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="page-head">
        <div>
          <h1 className="page-title">新建版本</h1>
          <p className="page-sub">
            {agent ? `${agent.name} · 基于当前版本预填，创建后需在详情页发布` : '加载中…'}
          </p>
        </div>
      </div>

      {apiError ? <p className="mt-4 text-[13px] text-red-500">{apiError}</p> : null}

      <form onSubmit={onSubmit} noValidate className="mt-6 flex flex-col gap-5">
        <section className="card card-pad">
          <h3 className="card-title">
            <Icon name="cpu" className="ic" />
            模型配置
          </h3>
          <div className="mt-4 grid g2">
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
          <div className="mt-4 grid g2">
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

        <section className="card card-pad">
          <h3 className="card-title">
            <Icon name="file-text" className="ic" />
            系统提示词
          </h3>
          <div className="field mt-4">
            <label htmlFor="version-system-prompt" className="lbl">
              System Prompt
            </label>
            <textarea
              id="version-system-prompt"
              rows={10}
              placeholder="定义智能体的角色、行为与回答风格…"
              className={`w-full resize-y rounded-[10px] border px-3.5 py-2.5 mono leading-relaxed outline-none transition placeholder:text-[#b3b9ce] ${
                errors.systemPrompt
                  ? 'border-[#f5c6c6] focus:border-[#dc2626] focus:ring-2 focus:ring-[#fdecec]'
                  : 'border-[var(--line-2)] focus:border-[var(--accent)] focus:ring-2 focus:ring-[#e4e6ff]'
              }`}
              {...register('systemPrompt')}
            />
            {errors.systemPrompt ? <p className="err-text">{errors.systemPrompt.message}</p> : null}
          </div>
        </section>

        <section className="card card-pad">
          <h3 className="card-title">
            <Icon name="book" className="ic" />
            知识库（RAG）
          </h3>
          <p className="card-sub mt-1">
            绑定后对话将检索知识库片段作为参考资料并附引用来源；不勾选 = 不启用 RAG。绑定随版本快照保存（knowledge.md D11）。
          </p>
          {kbList && kbList.length > 0 ? (
            <ul className="mt-4 grid g2">
              {kbList.map((kb) => (
                <li key={kb.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-[10px] border border-[var(--line)] px-3 py-2.5 text-[13.5px] transition hover:bg-[var(--surface-2)]">
                    <input
                      type="checkbox"
                      checked={selectedKbIds.includes(kb.id)}
                      onChange={() => toggleKb(kb.id)}
                      className="h-4 w-4 rounded accent-[#5b5bd6]"
                    />
                    <span className="min-w-0 flex-1 truncate">{kb.name}</span>
                    <span className="shrink-0 text-[12px] muted">{kb.document_count} 文档</span>
                  </label>
                </li>
              ))}
            </ul>
          ) : (
            <div className="empty mt-4" style={{ padding: '26px 16px' }}>
              <p>该组织暂无知识库，可先在「知识库」中创建并上传文档</p>
            </div>
          )}
          {selectedKbIds.length > 0 ? (
            <div className="mt-4 w-44">
              <TextField
                label="检索条数（每个知识库）"
                type="number"
                min={1}
                max={50}
                value={ragTopK}
                onChange={(e) => setRagTopK(Number(e.target.value))}
                required
              />
            </div>
          ) : null}
        </section>

        <div className="row-actions">
          <button
            type="button"
            onClick={() => navigate(agentDetailPath(orgId, agentId))}
            className="btn ghost"
          >
            取消
          </button>
          <button type="submit" disabled={submitMutation.isPending} className="btn primary">
            {submitMutation.isPending ? '创建中…' : '创建版本'}
          </button>
        </div>
      </form>
    </div>
  )
}
