// pages/knowledge/List.tsx
// 知识库列表：卡片网格（名称/Embedding 模型/Chunk 配置/文档统计/更新时间）+ 新建/删除入口（后台角色矩阵渲染）
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'

import { knowledgeApi } from '@/api'
import Icon from '@/components/Icon'
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
    return <p className="muted">组织参数无效</p>
  }

  const handleDelete = (kbId: number, name: string) => {
    setApiError('')
    if (window.confirm(`确定删除知识库「${name}」？其全部文档与向量数据将一并删除。`)) {
      deleteMutation.mutate(kbId)
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">知识库</h1>
          <p className="page-sub">
            {org ? `${org.name} · 企业文档管理、向量化与 RAG 检索测试` : '加载中…'}
          </p>
        </div>
        {canManage ? (
          <button
            type="button"
            onClick={() => navigate(knowledgeBaseNewPath(orgId))}
            className="btn primary"
          >
            <Icon name="plus" className="ic" />
            新建知识库
          </button>
        ) : null}
      </div>

      {apiError ? <p className="mt-4 text-[13px] text-red-500">{apiError}</p> : null}

      {isPending ? (
        <p className="mt-6 muted">加载中…</p>
      ) : kbs && kbs.length > 0 ? (
        <ul className="grid g2 mt-6 xl:grid-cols-3">
          {kbs.map((kb) => (
            <li key={kb.id} className="card card-pad flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <span className="avatar md av-3">
                  <Icon name="book" width={16} height={16} />
                </span>
                <h3 className="truncate text-[15px] font-bold">{kb.name}</h3>
                {kb.processing_count > 0 ? (
                  <span className="badge proc">{kb.processing_count} 处理中</span>
                ) : null}
              </div>
              <p className="text-[12px] muted">
                <span className="mono">{kb.embedding_model}</span> · 片段{' '}
                <span className="mono">{kb.chunk_size}/{kb.chunk_overlap}</span>
              </p>
              <p className="line-clamp-2 min-h-9 text-[13px] muted">
                {kb.description || '暂无描述'}
              </p>
              <p className="text-[12px] muted">
                {kb.document_count} 个文档 · 更新于{' '}
                {new Date(kb.updated_at).toLocaleDateString('zh-CN')}
              </p>
              <div className="row-actions mt-1">
                <button
                  type="button"
                  onClick={() => navigate(knowledgeBaseDetailPath(orgId, kb.id))}
                  className="btn primary xs"
                >
                  查看
                </button>
                {canManage ? (
                  <>
                    <button
                      type="button"
                      onClick={() => navigate(knowledgeBaseEditPath(orgId, kb.id))}
                      className="btn ghost xs"
                    >
                      编辑
                    </button>
                    <button
                      type="button"
                      disabled={deleteMutation.isPending && deleteMutation.variables === kb.id}
                      onClick={() => handleDelete(kb.id, kb.name)}
                      className="btn xs danger-ghost ml-auto"
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
        <div className="empty mt-6">
          <Icon name="book" className="ic" />
          <p>
            {canManage ? '尚未创建知识库，点击右上角「新建知识库」上传企业文档' : '该组织暂无知识库'}
          </p>
          {canManage ? (
            <div className="actions">
              <button
                type="button"
                onClick={() => navigate(knowledgeBaseNewPath(orgId))}
                className="btn primary sm"
              >
                <Icon name="plus" className="ic" />
                新建知识库
              </button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
