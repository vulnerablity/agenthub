// pages/model-providers/Form.tsx
// 模型供应商新建/编辑：create 选类型联动目录预览与必密校验（后端自动导入预置模型）；
// edit 锁类型、api_key 留空不改（清除按钮仅免密类型）、维护模型清单（model-providers.md §9 / D5 / D8）
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'

import { modelProvidersApi } from '@/api'
import Icon from '@/components/Icon'
import TextField from '@/components/form/TextField'
import { errorMessage } from '@/constants/error-messages'
import {
  DEFAULT_MODEL_CAPABILITIES,
  FALLBACK_REQUIRES_API_KEY,
  MODEL_CAPABILITY_LABELS,
  PROVIDER_TEST_ERROR_LABELS,
  PROVIDER_TYPE_BASE_URLS,
  providerTypeLabel,
} from '@/constants/model-providers'
import { modelProvidersPath } from '@/constants/routes'
import {
  modelProviderQueryKey,
  modelProvidersQueryKey,
  useModelProvider,
  useProviderCatalog,
} from '@/hooks/useModelProviders'
import type {
  ModelProviderCreateRequest,
  ModelProviderUpdateRequest,
  ProviderModelCapabilities,
  ProviderModelCreateRequest,
  ProviderModelItem,
  ProviderModelUpdateRequest,
  TestConnectionRequest,
  TestConnectionResponse,
} from '@/types'

/** 模型行本地草稿：capabilitiesTouched 区分「未设置（null）」与「显式设置」语义 */
interface ModelRowDraft {
  display_name: string
  capabilities: ProviderModelCapabilities
  enabled: boolean
  capabilitiesTouched: boolean
}

const CAPABILITY_KEYS = Object.keys(MODEL_CAPABILITY_LABELS) as Array<
  keyof ProviderModelCapabilities
>

export default function ModelProviderForm() {
  const { orgId: orgIdParam, providerId: providerIdParam } = useParams()
  const orgId = orgIdParam ? Number(orgIdParam) : null
  const providerId = providerIdParam ? Number(providerIdParam) : null
  const isEdit = providerId != null && !Number.isNaN(providerId)

  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: existing } = useModelProvider(orgId, providerId, isEdit)
  // 目录仅 create 需要（edit 的类型只读、模型走详情 models）
  const { data: catalog } = useProviderCatalog(orgId, !isEdit)

  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [providerType, setProviderType] = useState('')
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [enabled, setEnabled] = useState(true)
  // 编辑态「清除已存密钥」标记（仅免密类型可见，D5 空串清空语义）
  const [clearKey, setClearKey] = useState(false)
  const [apiError, setApiError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // 测试连接状态
  const [testModelKey, setTestModelKey] = useState('')
  const [testResult, setTestResult] = useState<TestConnectionResponse | null>(null)
  // 模型行草稿（编辑态）；以模型 id 集合为签名，增删行后重置为服务端值
  const [modelDrafts, setModelDrafts] = useState<Record<number, ModelRowDraft>>({})
  const [modelsSig, setModelsSig] = useState('')
  // 新增模型行表单
  const [newModelKey, setNewModelKey] = useState('')
  const [newModelName, setNewModelName] = useState('')
  const [newCaps, setNewCaps] = useState<ProviderModelCapabilities>({
    ...DEFAULT_MODEL_CAPABILITIES,
  })
  const [newEnabled, setNewEnabled] = useState(true)
  // 上次已预填的供应商 id：编辑态数据加载后于渲染期同步预填（官方 adjust-state-during-render
  // 模式，避免 effect 内 setState 的连锁渲染，react-hooks/set-state-in-effect）
  const [loadedProviderId, setLoadedProviderId] = useState<number | null>(null)

  if (isEdit && existing && loadedProviderId !== existing.id) {
    setLoadedProviderId(existing.id)
    setName(existing.name)
    setBaseUrl(existing.base_url)
    setEnabled(existing.enabled)
  }

  // 模型行草稿同步：增删模型后（id 集合变化）以服务端数据重建草稿
  const models: ProviderModelItem[] = existing?.models ?? []
  const modelsKey = models.map((m) => m.id).join(',')
  if (isEdit && existing && modelsKey !== modelsSig) {
    setModelsSig(modelsKey)
    const next: Record<number, ModelRowDraft> = {}
    for (const m of models) {
      next[m.id] = {
        display_name: m.display_name,
        capabilities: m.capabilities ?? { ...DEFAULT_MODEL_CAPABILITIES },
        enabled: m.enabled,
        capabilitiesTouched: false,
      }
    }
    setModelDrafts(next)
  }

  const currentType = isEdit ? (existing?.provider_type ?? '') : providerType
  // 必密判定：create 优先用后端目录，未加载时用前端镜像兜底；edit 类型固定走镜像
  const requiresApiKey =
    !isEdit &&
    providerType !== '' &&
    (catalog?.requires_api_key ?? FALLBACK_REQUIRES_API_KEY).includes(providerType)
  const isKeyOptionalType =
    currentType !== '' && !FALLBACK_REQUIRES_API_KEY.includes(currentType)
  const presets =
    !isEdit && providerType !== '' ? (catalog?.catalogs?.[providerType] ?? []) : []

  const invalidateProvider = async () => {
    await queryClient.invalidateQueries({ queryKey: modelProvidersQueryKey(orgId ?? 0) })
    await queryClient.invalidateQueries({
      queryKey: modelProviderQueryKey(orgId ?? 0, providerId ?? 0),
    })
  }

  const testMutation = useMutation({
    mutationFn: () => {
      const payload: TestConnectionRequest = { base_url: baseUrl.trim() }
      if (apiKeyInput.trim() !== '') payload.api_key = apiKeyInput.trim()
      if (testModelKey.trim() !== '') payload.model_key = testModelKey.trim()
      if (currentType !== '') payload.provider_type = currentType
      return modelProvidersApi.testConnection(payload)
    },
    onSuccess: (res) => setTestResult(res.data),
  })

  const saveModelMutation = useMutation({
    mutationFn: ({ modelId, draft }: { modelId: number; draft: ModelRowDraft }) => {
      const original = models.find((m) => m.id === modelId)
      const payload: ProviderModelUpdateRequest = {
        display_name: draft.display_name.trim() ? draft.display_name.trim() : undefined,
        enabled: draft.enabled,
      }
      // 保留「未设置」语义：原值为 null 且未改动能力时不下发 capabilities
      if (original?.capabilities != null || draft.capabilitiesTouched) {
        payload.capabilities = draft.capabilities
      }
      return modelProvidersApi.updateModel(providerId!, modelId, payload)
    },
    onSuccess: () => invalidateProvider(),
    onError: (error) => setApiError(errorMessage(error)),
  })

  const addModelMutation = useMutation({
    mutationFn: () => {
      const payload: ProviderModelCreateRequest = {
        model_key: newModelKey.trim(),
        display_name: newModelName.trim() || newModelKey.trim(),
        capabilities: { ...newCaps },
        enabled: newEnabled,
      }
      return modelProvidersApi.addModel(providerId!, payload)
    },
    onSuccess: async () => {
      setNewModelKey('')
      setNewModelName('')
      setNewCaps({ ...DEFAULT_MODEL_CAPABILITIES })
      setNewEnabled(true)
      await invalidateProvider()
    },
    onError: (error) => setApiError(errorMessage(error)),
  })

  const deleteModelMutation = useMutation({
    mutationFn: (modelId: number) => modelProvidersApi.removeModel(providerId!, modelId),
    onSuccess: () => invalidateProvider(),
    onError: (error) => setApiError(errorMessage(error)),
  })

  if (orgId == null || Number.isNaN(orgId)) {
    return <p className="muted">组织参数无效</p>
  }

  if (isEdit && !existing) {
    return <p className="muted">供应商不存在</p>
  }

  const updateDraft = (modelId: number, patch: Partial<ModelRowDraft>) => {
    setModelDrafts((prev) =>
      prev[modelId]
        ? { ...prev, [modelId]: { ...prev[modelId], ...patch } }
        : prev,
    )
  }

  const handleTypeChange = (type: string) => {
    setProviderType(type)
    setBaseUrl(PROVIDER_TYPE_BASE_URLS[type] ?? '')
    setTestResult(null)
  }

  const handleDeleteModel = (model: ProviderModelItem) => {
    setApiError('')
    if (
      window.confirm(
        `确定删除模型「${model.display_name}（${model.model_key}）」？引用该模型的版本将按默认能力处理。`,
      )
    ) {
      deleteModelMutation.mutate(model.id)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setApiError('')
    const trimmedName = name.trim()
    const trimmedBaseUrl = baseUrl.trim()
    if (!trimmedName || !trimmedBaseUrl) return
    if (!isEdit && providerType === '') return
    if (requiresApiKey && apiKeyInput.trim() === '') {
      setApiError('该类型供应商必须配置 API Key')
      return
    }
    setSubmitting(true)
    try {
      if (isEdit && providerId != null) {
        // api_key 三态（D5）：留空 = 不修改；勾选清除 = 空串显式清空（仅免密类型）；有输入 = 替换
        const payload: ModelProviderUpdateRequest = {
          name: trimmedName,
          base_url: trimmedBaseUrl,
          enabled,
        }
        if (apiKeyInput.trim() !== '') {
          payload.api_key = apiKeyInput.trim()
        } else if (clearKey && isKeyOptionalType) {
          payload.api_key = ''
        }
        await modelProvidersApi.update(providerId, payload)
      } else {
        const payload: ModelProviderCreateRequest = {
          name: trimmedName,
          provider_type: providerType,
          base_url: trimmedBaseUrl,
        }
        if (apiKeyInput.trim() !== '') payload.api_key = apiKeyInput.trim()
        await modelProvidersApi.create(payload)
      }
      await queryClient.invalidateQueries({ queryKey: modelProvidersQueryKey(orgId) })
      navigate(modelProvidersPath(orgId))
    } catch (error) {
      setApiError(errorMessage(error))
      setSubmitting(false)
    }
  }

  const testDisabled =
    baseUrl.trim() === '' ||
    testMutation.isPending ||
    (requiresApiKey && apiKeyInput.trim() === '')

  return (
    <div className="mx-auto max-w-2xl">
      <button
        type="button"
        onClick={() => navigate(modelProvidersPath(orgId))}
        className="btn ghost xs"
      >
        <Icon name="back" className="ic" />
        返回
      </button>

      <div className="page-head mt-4">
        <div>
          <h1 className="page-title">{isEdit ? '编辑供应商' : '新建供应商'}</h1>
          <p className="page-sub">
            {isEdit
              ? '类型创建后不可修改；api_key 留空表示不修改，模型清单可在此维护'
              : '创建后将按所选类型一次性导入预置模型清单（model-providers.md D8）'}
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="card card-pad mt-5 flex flex-col gap-5">
        <TextField
          label="名称"
          placeholder="例如：DeepSeek 官方"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={100}
        />

        <div className="field">
          <label htmlFor="provider-type" className="lbl">
            供应商类型
          </label>
          {isEdit ? (
            <>
              <div className="input">
                <input value={providerTypeLabel(currentType)} readOnly />
              </div>
              <p className="mt-1.5 text-[12px] muted">
                类型创建后不可修改（目录导入语义，model-providers.md D8）
              </p>
            </>
          ) : (
            <>
              <select
                id="provider-type"
                className="select w-full"
                value={providerType}
                onChange={(e) => handleTypeChange(e.target.value)}
                required
              >
                <option value="" disabled>
                  请选择类型
                </option>
                {Object.keys(PROVIDER_TYPE_BASE_URLS).map((type) => (
                  <option key={type} value={type}>
                    {providerTypeLabel(type)}
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-[12px] muted">
                切换类型将自动预填该平台默认 API 地址（可修改）
              </p>
            </>
          )}
        </div>

        <TextField
          label="Base URL"
          placeholder="例如：https://api.deepseek.com/v1"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          required
          maxLength={500}
        />

        <div className="field">
          <label htmlFor="provider-api-key" className="lbl">
            API Key{requiresApiKey ? '（必填）' : isEdit ? '（留空表示不修改）' : '（可选）'}
          </label>
          <div className="input">
            <input
              id="provider-api-key"
              type="password"
              autoComplete="new-password"
              placeholder={
                isEdit
                  ? existing?.key_status === 'set'
                    ? `已存密钥 ${existing.api_key_masked ?? '已设置'}，留空不修改`
                    : existing?.key_status === 'invalid'
                      ? '已存密钥不可用，请重新录入'
                      : '未设置密钥'
                  : requiresApiKey
                    ? '该类型必须配置 API Key'
                    : '免密类型可留空'
              }
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              maxLength={2000}
            />
            {isEdit && isKeyOptionalType ? (
              <button
                type="button"
                className={`btn xs ${clearKey ? 'danger-ghost' : 'ghost'}`}
                onClick={() => setClearKey((v) => !v)}
              >
                {clearKey ? '取消清除' : '清除已存密钥'}
              </button>
            ) : null}
          </div>
          {clearKey && isKeyOptionalType ? (
            <p className="mt-1.5 text-[12px] text-red-500">
              已标记清除：提交后该供应商密钥将被清空（免密类型允许）
            </p>
          ) : null}
          {isEdit && existing?.key_status === 'invalid' ? (
            <p className="mt-1.5 text-[12px] text-red-500">
              已存密钥不可解密（加密密钥可能已更换），请重新录入 API Key
            </p>
          ) : null}
        </div>

        {isEdit ? (
          <label className="flex cursor-pointer items-center gap-2 text-[13.5px]">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="h-4 w-4 rounded accent-[#5b5bd6]"
            />
            启用该供应商（停用后引用它的智能体对话将失败）
          </label>
        ) : null}

        {!isEdit && providerType !== '' ? (
          <div className="field">
            <span className="lbl">预置模型清单（创建后自动导入，仅展示）</span>
            {presets.length > 0 ? (
              <ul className="flex flex-col gap-1.5">
                {presets.map((preset) => (
                  <li
                    key={preset.model_key}
                    className="flex items-center gap-2 rounded-[10px] border border-[var(--line)] px-3 py-2 text-[12.5px]"
                  >
                    <span className="mono font-semibold">{preset.model_key}</span>
                    <span className="muted">{preset.display_name ?? preset.model_key}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12.5px] muted">
                该类型无预置模型（如豆包接入点 ep-xxx、Ollama 本地模型），创建后可在编辑页手动添加。
              </p>
            )}
          </div>
        ) : null}

        <div className="field">
          <label htmlFor="provider-test-model" className="lbl">
            测试连接（可填模型标识，留空测连通与鉴权）
          </label>
          <div className="flex items-center gap-2">
            <div className="input flex-1">
              <input
                id="provider-test-model"
                placeholder="例如：deepseek-chat（填写后按对话模式实测）"
                value={testModelKey}
                onChange={(e) => setTestModelKey(e.target.value)}
                maxLength={100}
              />
            </div>
            <button
              type="button"
              className="btn ghost"
              disabled={testDisabled}
              onClick={() => {
                setTestResult(null)
                testMutation.mutate()
              }}
            >
              {testMutation.isPending ? '测试中…' : '测试连接'}
            </button>
          </div>
          {testResult ? (
            testResult.ok ? (
              <p className="mt-1.5 text-[12.5px] text-green-600">
                连接成功 · 延迟 {testResult.latency_ms}ms
              </p>
            ) : (
              <p className="mt-1.5 text-[12.5px] text-red-500">
                测试失败：
                {testResult.error_type
                  ? PROVIDER_TEST_ERROR_LABELS[testResult.error_type]
                  : '未知错误'}
                {testResult.message ? `（${testResult.message}）` : ''}
              </p>
            )
          ) : isEdit && apiKeyInput.trim() === '' ? (
            <p className="mt-1.5 text-[12px] muted">
              未输入新密钥时将不带密钥测试（必密类型会返回鉴权失败）
            </p>
          ) : null}
        </div>

        {apiError ? <p className="text-[13px] text-red-500">{apiError}</p> : null}

        <div className="row-actions">
          <button
            type="button"
            className="btn ghost"
            onClick={() => navigate(modelProvidersPath(orgId))}
          >
            取消
          </button>
          <button
            type="submit"
            disabled={
              submitting ||
              !name.trim() ||
              !baseUrl.trim() ||
              (!isEdit && providerType === '')
            }
            className="btn primary"
          >
            {submitting ? '保存中…' : isEdit ? '保存' : '创建'}
          </button>
        </div>
      </form>

      {isEdit && providerId != null ? (
        <section className="card card-pad mt-5">
          <h3 className="card-title">
            <Icon name="cpu" className="ic" />
            模型清单
          </h3>
          <p className="card-sub mt-1">
            model_key 创建后不可变（版本弱引用匹配键）；能力未显式设置的行按默认处理（工具调用开 / 思考关 / 流式用量开）。
          </p>

          {models.length > 0 ? (
            <ul className="mt-4 flex flex-col gap-3">
              {models.map((model) => {
                const draft = modelDrafts[model.id]
                if (!draft) return null
                const capsUnset = model.capabilities == null
                return (
                  <li
                    key={model.id}
                    className="flex flex-col gap-2.5 rounded-[10px] border border-[var(--line)] p-3.5"
                  >
                    <div className="flex items-center gap-2">
                      <span className="mono text-[13px] font-semibold">{model.model_key}</span>
                      {capsUnset ? <span className="badge warn">能力未设置</span> : null}
                      <button
                        type="button"
                        className="btn xs danger-ghost ml-auto"
                        disabled={
                          deleteModelMutation.isPending &&
                          deleteModelMutation.variables === model.id
                        }
                        onClick={() => handleDeleteModel(model)}
                      >
                        {deleteModelMutation.isPending &&
                        deleteModelMutation.variables === model.id
                          ? '删除中…'
                          : '删除'}
                      </button>
                    </div>
                    <div className="grid g2">
                      <TextField
                        label="显示名称"
                        value={draft.display_name}
                        onChange={(e) => updateDraft(model.id, { display_name: e.target.value })}
                        maxLength={100}
                      />
                      <div className="field">
                        <span className="lbl">状态</span>
                        <label className="flex cursor-pointer items-center gap-2 text-[13px]">
                          <input
                            type="checkbox"
                            checked={draft.enabled}
                            onChange={(e) => updateDraft(model.id, { enabled: e.target.checked })}
                            className="h-4 w-4 rounded accent-[#5b5bd6]"
                          />
                          启用该模型（禁用后新建版本不可选）
                        </label>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                      {CAPABILITY_KEYS.map((key) => (
                        <label
                          key={key}
                          className="flex cursor-pointer items-center gap-1.5 text-[12.5px]"
                        >
                          <input
                            type="checkbox"
                            checked={draft.capabilities[key]}
                            onChange={(e) =>
                              updateDraft(model.id, {
                                capabilities: {
                                  ...draft.capabilities,
                                  [key]: e.target.checked,
                                },
                                capabilitiesTouched: true,
                              })
                            }
                            className="h-4 w-4 rounded accent-[#5b5bd6]"
                          />
                          {MODEL_CAPABILITY_LABELS[key]}
                        </label>
                      ))}
                      <button
                        type="button"
                        className="btn ghost xs ml-auto"
                        disabled={
                          saveModelMutation.isPending &&
                          saveModelMutation.variables?.modelId === model.id
                        }
                        onClick={() => saveModelMutation.mutate({ modelId: model.id, draft })}
                      >
                        {saveModelMutation.isPending &&
                        saveModelMutation.variables?.modelId === model.id
                          ? '保存中…'
                          : '保存修改'}
                      </button>
                    </div>
                    {capsUnset ? (
                      <p className="text-[12px] muted">
                        该行能力未显式设置：路由时按默认处理（工具调用开 / 思考关 / 流式用量开）；保存修改后写入显式配置。
                      </p>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="mt-4 text-[13px] muted">
              暂无模型（该类型无预置目录或已被清空），可在下方手动添加。
            </p>
          )}

          <div className="mt-5 rounded-[10px] border border-[var(--line-2)] p-3.5">
            <p className="text-[13px] font-semibold">新增模型</p>
            <div className="mt-3 grid g2">
              <TextField
                label="模型标识（model_key）"
                placeholder="例如：deepseek-chat / ep-2024xxxx"
                value={newModelKey}
                onChange={(e) => setNewModelKey(e.target.value)}
                maxLength={100}
              />
              <TextField
                label="显示名称（留空同模型标识）"
                placeholder="例如：DeepSeek Chat"
                value={newModelName}
                onChange={(e) => setNewModelName(e.target.value)}
                maxLength={100}
              />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
              {CAPABILITY_KEYS.map((key) => (
                <label
                  key={key}
                  className="flex cursor-pointer items-center gap-1.5 text-[12.5px]"
                >
                  <input
                    type="checkbox"
                    checked={newCaps[key]}
                    onChange={(e) =>
                      setNewCaps((prev) => ({ ...prev, [key]: e.target.checked }))
                    }
                    className="h-4 w-4 rounded accent-[#5b5bd6]"
                  />
                  {MODEL_CAPABILITY_LABELS[key]}
                </label>
              ))}
              <label className="flex cursor-pointer items-center gap-1.5 text-[12.5px]">
                <input
                  type="checkbox"
                  checked={newEnabled}
                  onChange={(e) => setNewEnabled(e.target.checked)}
                  className="h-4 w-4 rounded accent-[#5b5bd6]"
                />
                启用
              </label>
              <button
                type="button"
                className="btn primary xs ml-auto"
                disabled={newModelKey.trim() === '' || addModelMutation.isPending}
                onClick={() => addModelMutation.mutate()}
              >
                {addModelMutation.isPending ? '添加中…' : '添加模型'}
              </button>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  )
}
