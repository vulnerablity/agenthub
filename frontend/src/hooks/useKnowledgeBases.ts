// hooks/useKnowledgeBases.ts
// 组织知识库列表查询（组织隔离经请求头）
import { useQuery } from '@tanstack/react-query'

import { knowledgeApi } from '@/api'

export const knowledgeBasesQueryKey = (orgId: number) =>
  ['org', orgId, 'knowledge-bases'] as const

export function useKnowledgeBases(orgId: number | null, enabled = true) {
  return useQuery({
    queryKey: knowledgeBasesQueryKey(orgId ?? 0),
    queryFn: async () => (await knowledgeApi.list()).data,
    enabled: enabled && orgId != null,
    retry: false,
  })
}