// pages/auth/Login.tsx
// 登录页：邮箱 + 密码，成功后持久化双 Token 并回跳来源页
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link, useLocation, useNavigate } from 'react-router-dom'

import { authApi } from '@/api'
import TextField from '@/components/form/TextField'
import { errorMessage } from '@/constants/error-messages'
import { ROUTE_PATHS } from '@/constants/routes'
import { useAuthStore } from '@/stores/auth'
import { setTokens } from '@/utils/token'

const loginSchema = z.object({
  email: z.string().min(1, '请输入邮箱').email('邮箱格式不正确'),
  password: z.string().min(1, '请输入密码'),
})

type LoginForm = z.infer<typeof loginSchema>

interface LoginLocationState {
  from?: string
  email?: string
}

export default function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const signIn = useAuthStore((state) => state.signIn)
  const [apiError, setApiError] = useState('')

  // 注册成功跳转过来时预填邮箱
  const routeState = (location.state as LoginLocationState | null) ?? {}

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: routeState.email ?? '', password: '' },
  })

  const onSubmit = handleSubmit(async (values) => {
    setApiError('')
    try {
      const { data } = await authApi.login(values)
      setTokens(data.access_token, data.refresh_token)
      signIn()
      navigate(routeState.from ?? ROUTE_PATHS.HOME, { replace: true })
    } catch (error) {
      setApiError(errorMessage(error))
    }
  })

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 px-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm"
        noValidate
      >
        <h1 className="text-xl font-semibold text-neutral-900">登录 AgentHub</h1>
        <p className="mt-1 text-sm text-neutral-500">欢迎回来，请输入账号信息</p>

        <div className="mt-6 flex flex-col gap-4">
          <TextField
            label="邮箱"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            error={errors.email?.message}
            {...register('email')}
          />
          <TextField
            label="密码"
            type="password"
            autoComplete="current-password"
            placeholder="请输入密码"
            error={errors.password?.message}
            {...register('password')}
          />
        </div>

        {apiError ? <p className="mt-4 text-sm text-red-500">{apiError}</p> : null}

        <button
          type="submit"
          disabled={isSubmitting}
          className="mt-6 w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? '登录中…' : '登录'}
        </button>

        <p className="mt-4 text-center text-sm text-neutral-500">
          还没有账号？
          <Link to={ROUTE_PATHS.REGISTER} className="font-medium text-indigo-600 hover:underline">
            立即注册
          </Link>
        </p>
      </form>
    </div>
  )
}