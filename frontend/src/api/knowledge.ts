// api/knowledge.ts
// 知识库接口封装：与后端 /api/v1/knowledge-bases 与 /documents 对齐（组织隔离经请求头自动携带）
import type { AxiosProgressEvent } from 'axios'

import { http } from '@/utils/http'
import type {
  DocumentStatusDetail,
  KnowledgeBaseCreateRequest,
  KnowledgeBaseDetail,
  KnowledgeBaseUpdateRequest,
  KnowledgeDocumentItem,
  KnowledgeSearchRequest,
  KnowledgeSearchResponse,
} from '@/types'

export const knowledgeApi = {
  // ---------- 知识库 CRUD ----------
  create(data: KnowledgeBaseCreateRequest) {
    return http.post<KnowledgeBaseDetail>('/knowledge-bases', data)
  },
  list() {
    return http.get<KnowledgeBaseDetail[]>('/knowledge-bases')
  },
  get(kbId: number) {
    return http.get<KnowledgeBaseDetail>(`/knowledge-bases/${kbId}`)
  },
  update(kbId: number, data: KnowledgeBaseUpdateRequest) {
    return http.patch<KnowledgeBaseDetail>(`/knowledge-bases/${kbId}`, data)
  },
  remove(kbId: number) {
    return http.delete(`/knowledge-bases/${kbId}`)
  },

  // ---------- 文档 ----------
  listDocuments(kbId: number) {
    return http.get<KnowledgeDocumentItem[]>(`/knowledge-bases/${kbId}/documents`)
  },
  /** 上传文档（multipart，支持进度回调）：上传即返回 pending 文档（后端异步处理） */
  upload(kbId: number, file: File, onProgress?: (percent: number) => void) {
    const form = new FormData()
    form.append('file', file)
    return http.post<KnowledgeDocumentItem>(`/knowledge-bases/${kbId}/documents`, form, {
      onUploadProgress: (event: AxiosProgressEvent) => {
        if (onProgress && event.total) {
          onProgress(Math.round((event.loaded / event.total) * 100))
        }
      },
    })
  },
  removeDocument(documentId: number) {
    return http.delete(`/documents/${documentId}`)
  },
  getDocumentStatus(documentId: number) {
    return http.get<DocumentStatusDetail>(`/documents/${documentId}/status`)
  },

  // ---------- RAG 检索 ----------
  search(kbId: number, data: KnowledgeSearchRequest) {
    return http.post<KnowledgeSearchResponse>(`/knowledge-bases/${kbId}/search`, data)
  },
}