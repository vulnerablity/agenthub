// hooks/useKnowledgeBase.ts
// 知识库详情 / 更新 / 删除（管理操作走 mutation，组织隔离经请求头）
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { knowledgeApi } from '@/api'
import type { KnowledgeBaseUpdateRequest } from '@/types'
import { knowledgeBasesQueryKey } from './useKnowledgeBases'

export const knowledgeBaseQueryKey = (orgId: number, kbId: number) =>
  ['org', orgId, 'knowledge-bases', kbId] as const

export function useKnowledgeBase(
  orgId: number | null,
  kbId: number | null,
  enabled = true,
) {
  return useQuery({
    queryKey: knowledgeBaseQueryKey(orgId ?? 0, kbId ?? 0),
    queryFn: async () => (await knowledgeApi.get(kbId!)).data,
    enabled: enabled && orgId != null && kbId != null,
    retry: false,
  })
}

export function useKnowledgeBaseMutations(orgId: number | null) {
  const queryClient = useQueryClient()

  const invalidate = async (kbId: number) => {
    await queryClient.invalidateQueries({ queryKey: knowledgeBasesQueryKey(orgId ?? 0) })
    await queryClient.invalidateQueries({ queryKey: knowledgeBaseQueryKey(orgId ?? 0, kbId) })
  }

  const updateMutation = useMutation({
    mutationFn: ({ kbId, data }: { kbId: number; data: KnowledgeBaseUpdateRequest }) =>
      knowledgeApi.update(kbId, data),
    onSuccess: async (_res, { kbId }) => {
      await invalidate(kbId)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (kbId: number) => knowledgeApi.remove(kbId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: knowledgeBasesQueryKey(orgId ?? 0) })
    },
  })

  return { updateMutation, deleteMutation }
}