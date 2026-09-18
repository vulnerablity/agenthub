// types/auth.ts
// 用户认证协议类型：与 backend/app/schemas/auth.py 一一对应

export interface RegisterRequest {
  email: string
  username: string
  password: string
}

export interface RegisterResponse {
  id: number
  email: string
}

export interface LoginRequest {
  email: string
  password: string
}

export interface RefreshRequest {
  refresh_token: string
}

export interface TokenResponse {
  access_token: string
  refresh_token: string
  token_type: string
  /** access token 有效期（秒） */
  expires_in: number
}

export interface OrganizationBrief {
  id: number
  name: string
  role: string
}

export interface MeResponse {
  id: number
  email: string
  username: string
  avatar_url: string | null
  status: string
  created_at: string
  organizations: OrganizationBrief[]
}