// stores/auth.ts
// 登录态 UI 状态：Token 本体统一由 utils/token 管理，这里只维护认证布尔态与动作
import { create } from 'zustand'

import { hasAccessToken } from '@/utils/token'

interface AuthState {
  isAuthenticated: boolean
  signIn: () => void
  signOut: () => void
}

export const useAuthStore = create<AuthState>()((set) => ({
  isAuthenticated: hasAccessToken(),
  signIn: () => set({ isAuthenticated: true }),
  signOut: () => set({ isAuthenticated: false }),
}))