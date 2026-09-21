// types/knowledge.ts
// 知识库协议类型：与 backend/app/schemas/knowledge.py 一一对应（需求文档 3.6 / 4.8-4.10）
export type DocumentStatus = 'pending' | 'processing' | 'completed' | 'failed'

export interface KnowledgeBaseCreateRequest {
  name: string
  description?: string | null
  chunk_size?: number
  chunk_overlap?: number
}

export interface KnowledgeBaseUpdateRequest {
  name?: string | null
  description?: string | null
}

export interface KnowledgeBaseDetail {
  id: number
  name: string
  description: string | null
  embedding_model: string
  chunk_size: number
  chunk_overlap: number
  status: string
  document_count: number
  processing_count: number
  created_at: string
  updated_at: string
}

export interface KnowledgeDocumentItem {
  id: number
  filename: string
  file_type: string
  file_size: number
  status: DocumentStatus
  error_message: string | null
  chunk_count: number
  created_at: string
}

export interface DocumentStatusDetail {
  id: number
  filename: string
  status: DocumentStatus
  error_message: string | null
  chunk_count: number
}

export interface KnowledgeSearchRequest {
  query: string
  top_k?: number
}

export interface SearchResultItem {
  content: string
  document: string
  page: number | null
  score: number
}

export interface KnowledgeSearchResponse {
  results: SearchResultItem[]
}

/** 对话引用来源（D11）：done.sources 与 messages.metadata_json.sources 同构 */
export type RAGSource = SearchResultItem