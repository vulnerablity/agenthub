// types/http.ts
// HTTP 传输层通用类型：与后端统一错误格式 {code, message, detail} 对齐

/** 后端统一错误响应体（见 backend/app/core/exceptions.py） */
export interface ApiErrorBody {
  code: string
  message: string
  detail: unknown
}

/** 业务错误：由 axios 响应拦截器从错误响应体中构造 */
export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, body: ApiErrorBody) {
    super(body.message)
    this.name = 'ApiError'
    this.status = status
    this.code = body.code
  }
}