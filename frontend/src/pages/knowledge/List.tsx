// pages/knowledge/List.tsx
// 知识库列表：卡片网格（名称/Embedding 模型/Chunk 配置/文档统计/更新时间）+ 新建/删除入口（后台角色矩阵渲染）
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'

import { knowledgeApi } from '@/api'
import { canManageAgent } from '@/constants/agent-options'
import { errorMessage } from '@/constants/error-messages'
import {
  knowledgeBaseDetailPath,
  knowledgeBaseEditPath,
  knowledgeBaseNewPath,
} from '@/constants/routes'
import { useKnowledgeBases, knowledgeBasesQueryKey } from '@/hooks/useKnowledgeBases'
import { useOrg } from '@/hooks/useOrg'

export default function KnowledgeBaseList() {
  const { orgId: orgIdParam } = useParams()
  const orgId = orgIdParam ? Number(orgIdParam) : null

  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: org } = useOrg(orgId)
  const { data: kbs, isPending } = useKnowledgeBases(orgId)
  const [apiError, setApiError] = useState('')
  const canManage = canManageAgent(org?.my_role)

  const deleteMutation = useMutation({
    mutationFn: (kbId: number) => knowledgeApi.remove(kbId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: knowledgeBasesQueryKey(orgId ?? 0) }),
    onError: (error) => setApiError(errorMessage(error)),
  })

  if (orgId == null || Number.isNaN(orgId)) {
    return <p className="text-sm text-neutral-500">组织参数无效</p>
  }

  const handleDelete = (kbId: number, name: string) => {
    setApiError('')
    if (window.confirm(`确定删除知识库「${name}」？其全部文档与向量数据将一并删除。`)) {
      deleteMutation.mutate(kbId)
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-neutral-900">知识库</h2>
          <p className="mt-1 text-sm text-neutral-500">
            {org ? `${org.name} · 企业文档管理、向量化与 RAG 检索测试` : '加载中…'}
          </p>
        </div>
        {canManage ? (
          <button
            type="button"
            onClick={() => navigate(knowledgeBaseNewPath(orgId))}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700"
          >
            新建知识库
          </button>
        ) : null}
      </div>

      {apiError ? <p className="mt-4 text-sm text-red-500">{apiError}</p> : null}

      {isPending ? (
        <p className="mt-6 text-sm text-neutral-500">加载中…</p>
      ) : kbs && kbs.length > 0 ? (
        <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {kbs.map((kb) => (
            <li
              key={kb.id}
              className="flex flex-col justify-between rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm"
            >
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="truncate text-base font-semibold text-neutral-900">{kb.name}</h3>
                  {kb.processing_count > 0 ? (
                    <span className="shrink-0 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                      {kb.processing_count} 处理中
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 text-xs text-neutral-400">
                  {kb.embedding_model} · 片段 {kb.chunk_size}/{kb.chunk_overlap}
                </p>
                <p className="mt-3 line-clamp-2 min-h-8 text-xs text-neutral-500">
                  {kb.description || '暂无描述'}
                </p>
                <p className="mt-3 text-xs text-neutral-400">
                  {kb.document_count} 个文档 · 更新于 {new Date(kb.updated_at).toLocaleDateString('zh-CN')}
                </p>
              </div>
              <div className="mt-4 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => navigate(knowledgeBaseDetailPath(orgId, kb.id))}
                  className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-indigo-700"
                >
                  查看
                </button>
                {canManage ? (
                  <>
                    <button
                      type="button"
                      onClick={() => navigate(knowledgeBaseEditPath(orgId, kb.id))}
                      className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs text-neutral-700 transition hover:bg-neutral-100"
                    >
                      编辑
                    </button>
                    <button
                      type="button"
                      disabled={deleteMutation.isPending && deleteMutation.variables === kb.id}
                      onClick={() => handleDelete(kb.id, kb.name)}
                      className="ml-auto rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {deleteMutation.isPending && deleteMutation.variables === kb.id
                        ? '删除中…'
                        : '删除'}
                    </button>
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-6 rounded-2xl border border-dashed border-neutral-300 bg-white p-8 text-center">
          <p className="text-sm text-neutral-500">
            {canManage
              ? '尚未创建知识库，点击右上角「新建知识库」上传企业文档'
              : '该组织暂无知识库'}
          </p>
        </div>
      )}
    </div>
  )
}