// utils/http.ts
// HTTP 传输层：axios 实例、请求自动携带 Token、401 单飞刷新与请求重放
// 依赖约束：本模块只依赖 utils/token 与 types，不反向依赖 api/stores 等业务层
import axios from 'axios'
import type { AxiosError, AxiosRequestConfig, InternalAxiosRequestConfig } from 'axios'

import { ApiError } from '@/types/http'
import type { ApiErrorBody } from '@/types/http'
import type { TokenResponse } from '@/types/auth'
import { clearTokens, getAccessToken, getRefreshToken, setTokens } from './token'

export const BASE_URL = '/api/v1'

// 认证相关接口自身不触发无感刷新，避免登录失败时死循环
const SKIP_REFRESH_PATHS = ['/auth/login', '/auth/register', '/auth/refresh']

type RetryableConfig = InternalAxiosRequestConfig & { _retried?: boolean }

// 单飞状态：并发 401 共用同一个刷新 Promise
let refreshPromise: Promise<boolean> | null = null

// 401 且刷新失败时的全局回调（main.tsx 装配：清 Token、清缓存、置登出态）
let unauthorizedHandler: (() => void) | null = null

export function setOnUnauthorized(handler: () => void): void {
  unauthorizedHandler = handler
}

// 组织上下文提供者（main.tsx 装配：URL 中的 orgId 优先，回落 zustand currentOrgId）
// 所有请求自动携带 X-Organization-Id 请求头，后端按此做顶层资源（/agents 等）的组织隔离
let orgIdProvider: (() => number | null) | null = null

export function setOrgIdProvider(provider: () => number | null): void {
  orgIdProvider = provider
}

/** 调用刷新接口；使用无拦截器的裸 axios 实例，避免递归进入响应拦截器 */
async function refreshAccessToken(): Promise<boolean> {
  const refreshToken = getRefreshToken()
  if (!refreshToken) return false
  try {
    const { data } = await axios.post<TokenResponse>(`${BASE_URL}/auth/refresh`, {
      refresh_token: refreshToken,
    })
    setTokens(data.access_token, data.refresh_token)
    return true
  } catch {
    return false
  }
}

/** 把 axios 错误规整为业务 ApiError，非业务错误原样抛出 */
function normalizeError(error: AxiosError): Error {
  const body = error.response?.data as Partial<ApiErrorBody> | undefined
  if (body && typeof body.code === 'string' && typeof body.message === 'string') {
    return new ApiError(error.response!.status, {
      code: body.code,
      message: body.message,
      detail: body.detail ?? null,
    })
  }
  return error
}

export const http = axios.create({ baseURL: BASE_URL })

http.interceptors.request.use((config) => {
  const token = getAccessToken()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  const orgId = orgIdProvider?.()
  if (orgId != null) {
    config.headers['X-Organization-Id'] = String(orgId)
  }
  return config
})

http.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config as RetryableConfig | undefined
    const isUnauthorized = error.response?.status === 401

    // 非 401、已重试过、或缺配置：直接抛出规整后的错误
    if (!isUnauthorized || !config || config._retried) {
      throw normalizeError(error)
    }
    // 认证接口自身的 401 交给页面处理（登录失败、刷新失败）
    if (SKIP_REFRESH_PATHS.some((path) => config.url?.includes(path))) {
      throw normalizeError(error)
    }

    // 单飞刷新：并发 401 复用同一个 Promise
    refreshPromise ??= refreshAccessToken().finally(() => {
      refreshPromise = null
    })
    const refreshed = await refreshPromise

    if (!refreshed) {
      clearTokens()
      unauthorizedHandler?.()
      throw normalizeError(error)
    }

    // 刷新成功：标记已重试并重放原请求（请求拦截器会带上新 Token）
    config._retried = true
    return http.request(config as AxiosRequestConfig)
  },
)