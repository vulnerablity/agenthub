// api/auth.ts
// 用户认证接口封装：与后端 /api/v1/auth 对齐
import { http } from '@/utils/http'
import type {
  LoginRequest,
  MeResponse,
  RefreshRequest,
  RegisterRequest,
  RegisterResponse,
  TokenResponse,
} from '@/types/auth'

export const authApi = {
  register(data: RegisterRequest) {
    return http.post<RegisterResponse>('/auth/register', data)
  },
  login(data: LoginRequest) {
    return http.post<TokenResponse>('/auth/login', data)
  },
  refresh(data: RefreshRequest) {
    return http.post<TokenResponse>('/auth/refresh', data)
  },
  getMe() {
    return http.get<MeResponse>('/auth/me')
  },
}