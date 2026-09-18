// utils/token.ts
// Token 持久化唯一入口：拦截器、守卫、store 均通过本模块读写，避免散落操作 localStorage
const ACCESS_TOKEN_KEY = 'agenthub.access_token'
const REFRESH_TOKEN_KEY = 'agenthub.refresh_token'

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_TOKEN_KEY)
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_KEY)
}

export function setTokens(accessToken: string, refreshToken: string): void {
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken)
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken)
}

export function clearTokens(): void {
  localStorage.removeItem(ACCESS_TOKEN_KEY)
  localStorage.removeItem(REFRESH_TOKEN_KEY)
}

/** 是否有可用 access token（路由守卫快速判断用） */
export function hasAccessToken(): boolean {
  return Boolean(getAccessToken())
}