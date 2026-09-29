// constants/model-providers.ts
// 模型供应商常量：类型中文文案、base_url 预填地址、能力标签与测试连接错误映射
// （后端目录不含 base_url 预设，前端按各平台官方默认 API 地址预填，model-providers.md §9）
import type { ProviderModelCapabilities, ProviderTestErrorType } from '@/types'

/** 供应商类型 → 中文展示（未知类型原样展示，List/Form 共用） */
export const PROVIDER_TYPE_LABELS: Record<string, string> = {
  deepseek: 'DeepSeek',
  zhipu: '智谱',
  doubao: '豆包（火山方舟）',
  ollama: 'Ollama（本地/自建）',
  openai: 'OpenAI',
  custom: '自定义网关',
}

export function providerTypeLabel(providerType: string): string {
  return PROVIDER_TYPE_LABELS[providerType] ?? providerType
}

/** 各类型 base_url 预填默认地址（目录无预设时兜底，可修改） */
export const PROVIDER_TYPE_BASE_URLS: Record<string, string> = {
  deepseek: 'https://api.deepseek.com/v1',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4',
  doubao: 'https://ark.cn-beijing.volces.com/api/v3',
  ollama: 'http://localhost:11434/v1',
  openai: 'https://api.openai.com/v1',
  custom: '',
}

/** 能力矩阵键 → 中文标签（D4：一期消费 tool_call / stream_usage，reasoning 仅展示） */
export const MODEL_CAPABILITY_LABELS: Record<keyof ProviderModelCapabilities, string> = {
  tool_call: '工具调用',
  reasoning: '思考模式',
  stream_usage: '流式用量',
}

/** 后端 DEFAULT_CAPABILITIES 镜像：capabilities 为 null（未设置）时的生效行为 */
export const DEFAULT_MODEL_CAPABILITIES: ProviderModelCapabilities = {
  tool_call: true,
  reasoning: false,
  stream_usage: true,
}

/** 测试连接 error_type → 中文文案（§6 稳定枚举，message 后端有则追加） */
export const PROVIDER_TEST_ERROR_LABELS: Record<ProviderTestErrorType, string> = {
  auth: '密钥无效或无权限',
  model_not_found: '模型不存在',
  network: '无法连接',
  forbidden: '地址不被允许',
  unknown: '供应商返回异常',
}

/** 后端 REQUIRES_API_KEY 镜像：目录接口加载前的兜底必密判定 */
export const FALLBACK_REQUIRES_API_KEY: readonly string[] = [
  'deepseek',
  'doubao',
  'openai',
  'zhipu',
]
