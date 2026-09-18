// constants/error-messages.ts
// 错误文案：后端已返回中文 message 时优先透传，这里提供兜底
import { ApiError } from '@/types/http'

export const ERROR_MESSAGES = {
  NETWORK: '网络异常，请稍后重试',
  UNKNOWN: '操作失败，请稍后重试',
} as const

/** 从任意异常中提取可展示的中文文案 */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message
  }
  if (error instanceof Error && error.message) {
    // 非业务错误（如 axios 网络错误）统一用兜底文案
    return ERROR_MESSAGES.NETWORK
  }
  return ERROR_MESSAGES.UNKNOWN
}