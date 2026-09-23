// pages/knowledge/Detail.tsx
// 知识库详情：左 = KB 信息 + 文档管理（上传/状态徽标/失败原因/删除，处理中自动轮询）；
// 右 = RAG 检索测试面板（query/top_k → 内容片段 + 文档名 + 页码 + 分数，knowledge.md 4.3）
import { useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'

import Icon from '@/components/Icon'
import { canManageAgent } from '@/constants/agent-options'
import { errorMessage } from '@/constants/error-messages'
import { knowledgeBaseEditPath, knowledgeBasesPath } from '@/constants/routes'
import { useKnowledgeBase } from '@/hooks/useKnowledgeBase'
import { useDocumentMutations, useKnowledgeDocuments } from '@/hooks/useKnowledgeDocuments'
import { useKnowledgeSearch } from '@/hooks/useKnowledgeSearch'
import { useOrg } from '@/hooks/useOrg'
import type { DocumentStatus } from '@/types'

const DOC_STATUS_META: Record<DocumentStatus, { label: string; cls: string }> = {
  pending: { label: '待处理', cls: 'badge off' },
  processing: { label: '处理中', cls: 'badge proc' },
  completed: { label: '已完成', cls: 'badge ok' },
  failed: { label: '失败', cls: 'badge err' },
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
    return <p className="muted">参数无效</p>
  }

  if (isPending) {
    return <p className="muted">加载中…</p>
  }

  if (!kb) {
    return <p className="muted">知识库不存在</p>
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
    <div>
      <button type="button" onClick={() => navigate(knowledgeBasesPath(orgId))} className="btn ghost xs">
        <Icon name="back" className="ic" />
        返回知识库列表
      </button>

      {/* KB 信息卡 */}
      <div className="card card-pad mt-4 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <span className="avatar lg av-3">
            <Icon name="book" width={20} height={20} />
          </span>
          <div>
            <div className="flex items-center gap-3">
              <h2 className="page-title">{kb.name}</h2>
              {kb.processing_count > 0 ? (
                <span className="badge proc">{kb.processing_count} 处理中</span>
              ) : null}
            </div>
            <p className="mt-1 text-[13.5px] muted">{kb.description || '暂无描述'}</p>
            <p className="mt-2 text-[12px] muted">
              <span className="mono">{kb.embedding_model}</span> · 片段{' '}
              <span className="mono">{kb.chunk_size}/{kb.chunk_overlap}</span> · {kb.document_count} 个文档
            </p>
          </div>
        </div>
        {canManage ? (
          <button
            type="button"
            onClick={() => navigate(knowledgeBaseEditPath(orgId, kb.id))}
            className="btn ghost sm"
          >
            <Icon name="edit" className="ic" />
            编辑
          </button>
        ) : null}
      </div>

      {apiError ? <p className="mt-4 text-[13px] text-red-500">{apiError}</p> : null}

      <div className="mt-5 grid gap-5" style={{ gridTemplateColumns: '1fr 400px' }}>
        {/* 左：文档区 */}
        <div className="flex min-w-0 flex-col gap-4">
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
              className={`rounded-[14px] border-2 border-dashed p-6 text-center transition ${
                dragging ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--line-2)] bg-white'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.txt,.md"
                className="hidden"
                onChange={(e) => handleUpload(e.target.files?.[0])}
              />
              <Icon name="upload" width={26} height={26} style={{ color: '#c3c8de', margin: '0 auto' }} />
              <p className="mt-2 text-[13.5px] text-[var(--ink-2)]">
                拖拽文件到此处，或
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}
                  className="mx-1 font-semibold text-[var(--accent-ink)] transition hover:underline disabled:cursor-not-allowed disabled:opacity-60"
                >
                  点击选择
                </button>
                上传（仅 PDF / TXT / Markdown，≤ 20MB）
              </p>
              {uploading ? (
                <div className="mx-auto mt-3 h-2 w-64 overflow-hidden rounded-full bg-[#eef0f8]">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${uploadPercent ?? 0}%`,
                      background: 'var(--grad)',
                    }}
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          {hasRunning ? (
            <p className="text-[12px] muted">
              <Icon name="loader" width={12} height={12} style={{ verticalAlign: '-1px' }} />{' '}
              存在处理中的文档，状态将自动刷新…
            </p>
          ) : null}

          {documents && documents.length > 0 ? (
            <ul className="flex flex-col gap-3">
              {documents.map((doc) => {
                const meta = DOC_STATUS_META[doc.status]
                return (
                  <li key={doc.id} className="card card-pad flex items-center gap-4" style={{ padding: '14px 16px' }}>
                    <span className="avatar md av-6">
                      <Icon name="file-text" width={16} height={16} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p
                          className="truncate text-[13.5px] font-semibold"
                          title={doc.status === 'failed' ? (doc.error_message ?? undefined) : undefined}
                        >
                          {doc.filename}
                        </p>
                        <span className={meta.cls}>{meta.label}</span>
                      </div>
                      <p className="mt-1 text-[12px] muted">
                        {doc.file_type.toUpperCase()} · {formatBytes(doc.file_size)} ·{' '}
                        {doc.status === 'completed' ? `${doc.chunk_count} 个片段` : '—'} ·{' '}
                        {new Date(doc.created_at).toLocaleDateString('zh-CN')}
                      </p>
                      {doc.status === 'failed' && doc.error_message ? (
                        <p className="mt-1 line-clamp-2 text-[12px] text-red-500">
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
                        className="btn xs danger-ghost shrink-0"
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
            <div className="empty">
              <Icon name="file-text" className="ic" />
              <p>{canManage ? '尚未上传文档，拖拽或点击上方区域上传' : '该知识库暂无文档'}</p>
            </div>
          )}
        </div>

        {/* 右：检索测试面板 */}
        <div className="card card-pad h-fit" style={{ padding: '18px' }}>
          <h3 className="card-title">
            <Icon name="search" className="ic" />
            检索测试
          </h3>
          <p className="card-sub mt-1">验证 RAG 检索效果（内容 / 文档 / 页码 / 分数）</p>
          <div className="mt-4 flex flex-col gap-3">
            <div className="input">
              <Icon name="search" className="ic" />
              <input
                type="text"
                placeholder="输入测试问题，如：员工年假是多少"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSearch()
                }}
              />
            </div>
            <div className="flex items-center gap-3">
              <label htmlFor="kb-topk" className="text-[13px] text-[var(--ink-2)]">
                返回条数
              </label>
              <select
                id="kb-topk"
                value={topK}
                onChange={(e) => setTopK(Number(e.target.value))}
                className="select"
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
                className="btn primary sm ml-auto"
              >
                {search.isSearching ? '检索中…' : '检索'}
              </button>
            </div>
          </div>

          {search.searchError ? (
            <p className="mt-4 text-[12px] text-red-500">{errorMessage(search.searchError)}</p>
          ) : null}

          {search.result && search.result.results.length === 0 ? (
            <p className="mt-4 muted">未检索到相关内容</p>
          ) : null}

          {search.result && search.result.results.length > 0 ? (
            <ul className="mt-4 flex flex-col gap-3">
              {search.result.results.map((item, index) => (
                <li key={index} className="rounded-[12px] border border-[var(--line)] bg-[var(--surface-2)] p-3">
                  <div className="flex items-center gap-2">
                    <p className="min-w-0 flex-1 truncate text-[13px] font-semibold">
                      {item.document}
                    </p>
                    <span className="badge accent">{item.score.toFixed(2)}</span>
                  </div>
                  {item.page != null ? (
                    <p className="mt-1 text-[12px] muted">第 {item.page} 页</p>
                  ) : null}
                  <p className="mt-1 line-clamp-4 text-[12px] leading-relaxed text-[var(--ink-2)]">
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
