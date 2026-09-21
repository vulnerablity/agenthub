// hooks/useKnowledgeDocuments.ts
// 知识库文档列表：存在待处理/处理中文档时自动轮询（2s），全部定态后停止（knowledge.md 4.1）
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { knowledgeApi } from '@/api'
import { knowledgeBaseQueryKey } from './useKnowledgeBase'
import { knowledgeBasesQueryKey } from './useKnowledgeBases'

export const knowledgeDocumentsQueryKey = (orgId: number, kbId: number) =>
  ['org', orgId, 'knowledge-bases', kbId, 'documents'] as const

export function useKnowledgeDocuments(
  orgId: number | null,
  kbId: number | null,
  enabled = true,
) {
  return useQuery({
    queryKey: knowledgeDocumentsQueryKey(orgId ?? 0, kbId ?? 0),
    queryFn: async () => (await knowledgeApi.listDocuments(kbId!)).data,
    enabled: enabled && orgId != null && kbId != null,
    retry: false,
    refetchInterval: (query) => {
      const docs = query.state.data
      if (docs?.some((d) => d.status === 'pending' || d.status === 'processing')) {
        return 2000
      }
      return false
    },
  })
}

export function useDocumentMutations(orgId: number | null, kbId: number | null) {
  const queryClient = useQueryClient()

  const invalidate = async () => {
    await queryClient.invalidateQueries({
      queryKey: knowledgeDocumentsQueryKey(orgId ?? 0, kbId ?? 0),
    })
    await queryClient.invalidateQueries({ queryKey: knowledgeBaseQueryKey(orgId ?? 0, kbId ?? 0) })
    await queryClient.invalidateQueries({ queryKey: knowledgeBasesQueryKey(orgId ?? 0) })
  }

  /** 上传成功：新文档以 pending 入列，轮询自然接管状态刷新 */
  const uploadMutation = useMutation({
    mutationFn: ({
      file,
      onProgress,
    }: {
      file: File
      onProgress?: (percent: number) => void
    }) => knowledgeApi.upload(kbId!, file, onProgress),
    onSuccess: invalidate,
  })

  const deleteDocumentMutation = useMutation({
    mutationFn: (documentId: number) => knowledgeApi.removeDocument(documentId),
    onSuccess: invalidate,
  })

  return { uploadMutation, deleteDocumentMutation }
}