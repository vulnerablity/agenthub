// hooks/useKnowledgeSearch.ts
// RAG 检索测试（knowledge.md 4.1）：提交检索并就地保留最近一次结果
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'

import { knowledgeApi } from '@/api'
import type { KnowledgeSearchRequest, KnowledgeSearchResponse } from '@/types'

export function useKnowledgeSearch(kbId: number | null) {
  const [result, setResult] = useState<KnowledgeSearchResponse | null>(null)

  const mutation = useMutation({
    mutationFn: async (data: KnowledgeSearchRequest) =>
      (await knowledgeApi.search(kbId!, data)).data,
    onSuccess: setResult,
    onError: () => setResult(null),
  })

  const run = (data: KnowledgeSearchRequest) => {
    setResult(null)
    mutation.mutate(data)
  }

  return {
    result,
    isSearching: mutation.isPending,
    searchError: mutation.error,
    run,
    reset: () => setResult(null),
  }
}