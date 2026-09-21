// pages/knowledge/Form.tsx
// 知识库新建/编辑：新建含 chunk 参数（后不可改），编辑仅名称/描述（knowledge.md D7）
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { knowledgeApi } from '@/api'
import TextField from '@/components/form/TextField'
import { errorMessage } from '@/constants/error-messages'
import { knowledgeBaseDetailPath, knowledgeBasesPath } from '@/constants/routes'
import { useKnowledgeBase } from '@/hooks/useKnowledgeBase'

const DEFAULT_CHUNK_SIZE = 500
const DEFAULT_CHUNK_OVERLAP = 50

export default function KnowledgeBaseForm() {
  const { orgId: orgIdParam, kbId: kbIdParam } = useParams()
  const orgId = orgIdParam ? Number(orgIdParam) : null
  const kbId = kbIdParam ? Number(kbIdParam) : null
  const isEdit = kbId != null && !Number.isNaN(kbId)

  const navigate = useNavigate()
  const { data: existing } = useKnowledgeBase(orgId, kbId, isEdit)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [chunkSize, setChunkSize] = useState(DEFAULT_CHUNK_SIZE)
  const [chunkOverlap, setChunkOverlap] = useState(DEFAULT_CHUNK_OVERLAP)
  const [apiError, setApiError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // 上次已预填的知识库 id：编辑态数据加载后于渲染期同步预填（官方 adjust-state-during-render
  // 模式，避免 effect 内 setState 的连锁渲染，react-hooks/set-state-in-effect）
  const [loadedKbId, setLoadedKbId] = useState<number | null>(null)

  if (isEdit && existing && loadedKbId !== existing.id) {
    setLoadedKbId(existing.id)
    setName(existing.name)
    setDescription(existing.description ?? '')
  }

  if (orgId == null || Number.isNaN(orgId)) {
    return <p className="text-sm text-neutral-500">组织参数无效</p>
  }

  if (isEdit && !existing) {
    return <p className="text-sm text-neutral-500">知识库不存在</p>
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setApiError('')
    setSubmitting(true)
    try {
      if (isEdit) {
        await knowledgeApi.update(kbId, { name, description })
      } else {
        const created = (
          await knowledgeApi.create({
            name,
            description: description || null,
            chunk_size: chunkSize,
            chunk_overlap: chunkOverlap,
          })
        ).data
        navigate(knowledgeBaseDetailPath(orgId, created.id))
        return
      }
      navigate(knowledgeBaseDetailPath(orgId, kbId))
    } catch (error) {
      setApiError(errorMessage(error))
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <button
        type="button"
        onClick={() =>
          isEdit ? navigate(knowledgeBaseDetailPath(orgId, kbId)) : navigate(knowledgeBasesPath(orgId))
        }
        className="text-sm text-neutral-500 transition hover:text-neutral-700"
      >
        ← 返回
      </button>

      <h2 className="mt-4 text-xl font-semibold text-neutral-900">
        {isEdit ? '编辑知识库' : '新建知识库'}
      </h2>

      <form onSubmit={handleSubmit} className="mt-6 space-y-5 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
        <TextField
          label="名称"
          placeholder="例如：公司制度库"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={100}
        />
        <div className="flex flex-col gap-2">
          <label htmlFor="kb-description" className="text-sm font-medium text-neutral-700">
            描述
          </label>
          <textarea
            id="kb-description"
            rows={3}
            placeholder="知识库用途与内容范围"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={5000}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          />
        </div>

        {!isEdit ? (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-neutral-400">
              切分参数仅创建时可配置，创建后不可修改（仅对新增文档生效）；Embedding 模型全局统一（{existing?.embedding_model ?? '按服务配置'}）。
            </p>
            <div className="grid grid-cols-2 gap-4">
              <TextField
                label="片段大小（字符）"
                type="number"
                min={100}
                max={5000}
                value={chunkSize}
                onChange={(e) => setChunkSize(Number(e.target.value))}
                required
              />
              <TextField
                label="片段重叠（字符）"
                type="number"
                min={0}
                max={chunkSize - 1}
                value={chunkOverlap}
                onChange={(e) => setChunkOverlap(Number(e.target.value))}
                required
              />
            </div>
          </div>
        ) : null}

        {apiError ? <p className="text-sm text-red-500">{apiError}</p> : null}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={submitting || !name.trim()}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? '保存中…' : isEdit ? '保存' : '创建'}
          </button>
        </div>
      </form>
    </div>
  )
}