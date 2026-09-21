// pages/knowledge/Detail.tsx
// 知识库详情：左 = KB 信息 + 文档管理（上传/状态徽标/失败原因/删除，处理中自动轮询）；
// 右 = RAG 检索测试面板（query/top_k → 内容片段 + 文档名 + 页码 + 分数，knowledge.md 4.3）
import { useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'

import { canManageAgent } from '@/constants/agent-options'
import { errorMessage } from '@/constants/error-messages'
import { knowledgeBaseEditPath, knowledgeBasesPath } from '@/constants/routes'
import { useKnowledgeBase } from '@/hooks/useKnowledgeBase'
import { useDocumentMutations, useKnowledgeDocuments } from '@/hooks/useKnowledgeDocuments'
import { useKnowledgeSearch } from '@/hooks/useKnowledgeSearch'
import { useOrg } from '@/hooks/useOrg'
import type { DocumentStatus } from '@/types'

const DOC_STATUS_META: Record<DocumentStatus, { label: string; cls: string }> = {
  pending: { label: '待处理', cls: 'bg-neutral-100 text-neutral-500' },
  processing: { label: '处理中', cls: 'bg-blue-50 text-blue-700' },
  completed: { label: '已完成', cls: 'bg-emerald-50 text-emerald-700' },
  failed: { label: '失败', cls: 'bg-red-50 text-red-600' },
}

const TOP_K_OPTIONS = [1, 3, 5, 10]

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function KnowledgeBaseDetail() {
  const { orgId: orgIdParam, kbId: kbIdParam } = useParams()
  const orgId = orgIdParam ? Number(orgIdParam) : null
  const kbId = kbIdParam ? Number(kbIdParam) : null

  const navigate = useNavigate()
  const { data: org } = useOrg(orgId)
  const { data: kb, isPending } = useKnowledgeBase(orgId, kbId)
  const { data: documents } = useKnowledgeDocuments(orgId, kbId)
  const { uploadMutation, deleteDocumentMutation } = useDocumentMutations(orgId, kbId)
  const search = useKnowledgeSearch(kbId)

  const canManage = canManageAgent(org?.my_role)
  const [apiError, setApiError] = useState('')
  const [uploadPercent, setUploadPercent] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 检索测试面板本地状态
  const [query, setQuery] = useState('')
  const [topK, setTopK] = useState(5)

  if (orgId == null || kbId == null || Number.isNaN(orgId) || Number.isNaN(kbId)) {
    return <p className="text-sm text-neutral-500">参数无效</p>
  }

  if (isPending) {
    return <p className="text-sm text-neutral-500">加载中…</p>
  }

  if (!kb) {
    return <p className="text-sm text-neutral-500">知识库不存在</p>
  }

  const handleUpload = (file: File | undefined | null) => {
    if (!file) return
    setApiError('')
    setUploadPercent(0)
    uploadMutation.mutate(
      {
        file,
        onProgress: setUploadPercent,
      },
      {
        onSuccess: () => setUploadPercent(null),
        onError: (error) => {
          setUploadPercent(null)
          setApiError(errorMessage(error))
        },
      },
    )
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleDeleteDocument = (documentId: number, filename: string) => {
    setApiError('')
    if (window.confirm(`确定删除文档「${filename}」？其切块与向量数据将一并删除。`)) {
      deleteDocumentMutation.mutate(documentId, {
        onError: (error) => setApiError(errorMessage(error)),
      })
    }
  }

  const handleSearch = () => {
    if (!query.trim()) return
    search.run({ query: query.trim(), top_k: topK })
  }

  const uploading = uploadMutation.isPending
  const hasRunning = documents?.some((d) => d.status === 'pending' || d.status === 'processing')

  return (
    <div className="mx-auto max-w-6xl">
      <button
        type="button"
        onClick={() => navigate(knowledgeBasesPath(orgId))}
        className="text-sm text-neutral-500 transition hover:text-neutral-700"
      >
        ← 返回知识库列表
      </button>

      {/* KB 信息卡 */}
      <div className="mt-4 flex items-start justify-between rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
        <div>
          <h2 className="text-xl font-semibold text-neutral-900">{kb.name}</h2>
          <p className="mt-1 text-sm text-neutral-500">{kb.description || '暂无描述'}</p>
          <p className="mt-3 text-xs text-neutral-400">
            {kb.embedding_model} · 片段 {kb.chunk_size}/{kb.chunk_overlap} · {kb.document_count} 个文档
            {kb.processing_count > 0 ? `（${kb.processing_count} 处理中）` : ''}
          </p>
        </div>
        {canManage ? (
          <button
            type="button"
            onClick={() => navigate(knowledgeBaseEditPath(orgId, kb.id))}
            className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 transition hover:bg-neutral-100"
          >
            编辑
          </button>
        ) : null}
      </div>

      {apiError ? <p className="mt-4 text-sm text-red-500">{apiError}</p> : null}

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_400px]">
        {/* 左：文档区 */}
        <div className="flex flex-col gap-4">
          {canManage ? (
            <div
              onDragOver={(e) => {
                e.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragging(false)
                handleUpload(e.dataTransfer.files?.[0])
              }}
              className={`rounded-2xl border-2 border-dashed p-6 text-center transition ${
                dragging ? 'border-indigo-400 bg-indigo-50' : 'border-neutral-300 bg-white'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.txt,.md"
                className="hidden"
                onChange={(e) => handleUpload(e.target.files?.[0])}
              />
              <p className="text-sm text-neutral-600">
                拖拽文件到此处，或
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}
                  className="mx-1 font-medium text-indigo-600 transition hover:text-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  点击选择
                </button>
                上传（仅 PDF / TXT / Markdown，≤ 20MB）
              </p>
              {uploading ? (
                <div className="mx-auto mt-3 h-2 w-64 overflow-hidden rounded-full bg-neutral-200">
                  <div
                    className="h-full rounded-full bg-indigo-600 transition-all"
                    style={{ width: `${uploadPercent ?? 0}%` }}
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          {hasRunning ? (
            <p className="text-xs text-neutral-400">存在处理中的文档，状态将自动刷新…</p>
          ) : null}

          {documents && documents.length > 0 ? (
            <ul className="flex flex-col gap-3">
              {documents.map((doc) => {
                const meta = DOC_STATUS_META[doc.status]
                return (
                  <li
                    key={doc.id}
                    className="flex items-center gap-4 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p
                          className="truncate text-sm font-medium text-neutral-900"
                          title={doc.status === 'failed' ? (doc.error_message ?? undefined) : undefined}
                        >
                          {doc.filename}
                        </p>
                        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${meta.cls}`}>
                          {meta.label}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-neutral-400">
                        {doc.file_type.toUpperCase()} · {formatBytes(doc.file_size)} ·{' '}
                        {doc.status === 'completed' ? `${doc.chunk_count} 个片段` : '—'} ·{' '}
                        {new Date(doc.created_at).toLocaleDateString('zh-CN')}
                      </p>
                      {doc.status === 'failed' && doc.error_message ? (
                        <p className="mt-1 line-clamp-2 text-xs text-red-500">
                          {doc.error_message}（修复后可删除重新上传）
                        </p>
                      ) : null}
                    </div>
                    {canManage ? (
                      <button
                        type="button"
                        disabled={
                          deleteDocumentMutation.isPending &&
                          deleteDocumentMutation.variables === doc.id
                        }
                        onClick={() => handleDeleteDocument(doc.id, doc.filename)}
                        className="shrink-0 rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {deleteDocumentMutation.isPending &&
                        deleteDocumentMutation.variables === doc.id
                          ? '删除中…'
                          : '删除'}
                      </button>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          ) : (
            <div className="rounded-2xl border border-dashed border-neutral-300 bg-white p-8 text-center">
              <p className="text-sm text-neutral-500">
                {canManage ? '尚未上传文档，拖拽或点击上方区域上传' : '该知识库暂无文档'}
              </p>
            </div>
          )}
        </div>

        {/* 右：检索测试面板 */}
        <div className="h-fit rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
          <h3 className="text-base font-semibold text-neutral-900">检索测试</h3>
          <p className="mt-1 text-xs text-neutral-400">验证 RAG 检索效果（内容 / 文档 / 页码 / 分数）</p>
          <div className="mt-4 flex flex-col gap-3">
            <input
              type="text"
              placeholder="输入测试问题，如：员工年假是多少"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSearch()
              }}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            />
            <div className="flex items-center gap-3">
              <label htmlFor="kb-topk" className="text-sm text-neutral-600">
                返回条数
              </label>
              <select
                id="kb-topk"
                value={topK}
                onChange={(e) => setTopK(Number(e.target.value))}
                className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm text-neutral-900 outline-none focus:border-indigo-500"
              >
                {TOP_K_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={search.isSearching || !query.trim()}
                onClick={handleSearch}
                className="ml-auto rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {search.isSearching ? '检索中…' : '检索'}
              </button>
            </div>
          </div>

          {search.searchError ? (
            <p className="mt-4 text-xs text-red-500">{errorMessage(search.searchError)}</p>
          ) : null}

          {search.result && search.result.results.length === 0 ? (
            <p className="mt-4 text-sm text-neutral-500">未检索到相关内容</p>
          ) : null}

          {search.result && search.result.results.length > 0 ? (
            <ul className="mt-4 flex flex-col gap-3">
              {search.result.results.map((item, index) => (
                <li key={index} className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                  <div className="flex items-center gap-2">
                    <p className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-800">
                      {item.document}
                    </p>
                    <span className="shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
                      {item.score.toFixed(2)}
                    </span>
                  </div>
                  {item.page != null ? (
                    <p className="mt-1 text-xs text-neutral-400">第 {item.page} 页</p>
                  ) : null}
                  <p className="mt-1 line-clamp-4 text-xs leading-relaxed text-neutral-600">
                    {item.content}
                  </p>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </div>
  )
}