// pages/auth/Register.tsx
// 注册页：邮箱 + 用户名 + 密码，成功后跳登录页并预填邮箱
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link, useNavigate } from 'react-router-dom'

import { authApi } from '@/api'
import TextField from '@/components/form/TextField'
import { errorMessage } from '@/constants/error-messages'
import { ROUTE_PATHS } from '@/constants/routes'

// 校验规则与后端 schemas/auth.py 保持一致：密码最少 6 位、用户名 1-100
const registerSchema = z.object({
  email: z.string().min(1, '请输入邮箱').email('邮箱格式不正确'),
  username: z.string().min(1, '请输入用户名').max(100, '用户名不能超过 100 个字符'),
  password: z.string().min(6, '密码至少 6 位').max(128, '密码不能超过 128 位'),
})

type RegisterForm = z.infer<typeof registerSchema>

export default function Register() {
  const navigate = useNavigate()
  const [apiError, setApiError] = useState('')

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterForm>({
    resolver: zodResolver(registerSchema),
    defaultValues: { email: '', username: '', password: '' },
  })

  const onSubmit = handleSubmit(async (values) => {
    setApiError('')
    try {
      await authApi.register(values)
      // 注册成功：跳登录页并携带邮箱用于预填
      navigate(ROUTE_PATHS.LOGIN, { state: { email: values.email } })
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
        <h1 className="text-xl font-semibold text-neutral-900">创建账号</h1>
        <p className="mt-1 text-sm text-neutral-500">注册一个新的 AgentHub 账号</p>

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
            label="用户名"
            autoComplete="username"
            placeholder="请输入用户名"
            error={errors.username?.message}
            {...register('username')}
          />
          <TextField
            label="密码"
            type="password"
            autoComplete="new-password"
            placeholder="至少 6 位"
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
          {isSubmitting ? '注册中…' : '注册'}
        </button>

        <p className="mt-4 text-center text-sm text-neutral-500">
          已有账号？
          <Link to={ROUTE_PATHS.LOGIN} className="font-medium text-indigo-600 hover:underline">
            去登录
          </Link>
        </p>
      </form>
    </div>
  )
}