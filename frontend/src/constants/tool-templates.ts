// constants/tool-templates.ts
// HTTP 类型工具预设模板（tool-calling.md 3.3）：Search / Weather 以预填 config/schema 形式提供，
// 不写专用执行器，用户替换 API 地址与密钥后即可用
import type { ToolCreateRequest } from '@/types'

interface ToolTemplate {
  key: string
  label: string
  description: string
  config: Record<string, unknown>
  schema: Record<string, unknown>
}

/** 天气查询模板：适配 Open-Meteo 免费 API（无密钥） */
export const WEATHER_TEMPLATE: ToolTemplate = {
  key: 'weather',
  label: '天气查询',
  description: '查询指定城市的实时天气（Open-Meteo，输入城市名返回天气由 LLM 总结）',
  config: {
    url: 'https://api.open-meteo.com/v1/forecast?latitude={latitude}&longitude={longitude}&current_weather=true',
    method: 'GET',
  },
  schema: {
    type: 'object',
    properties: {
      latitude: { type: 'string', description: '城市纬度' },
      longitude: { type: 'string', description: '城市经度' },
    },
    required: ['latitude', 'longitude'],
  },
}

/** 网页搜索模板：适配自定义搜索 API（占位地址，需替换为实际服务） */
export const SEARCH_TEMPLATE: ToolTemplate = {
  key: 'search',
  label: '网页搜索',
  description: '按关键词搜索网页（需要替换为实际搜索 API 地址）',
  config: {
    url: 'https://your-search-api.example.com/search?q={query}',
    method: 'GET',
  },
  schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '搜索关键词' },
    },
    required: ['query'],
  },
}

export const HTTP_TOOL_TEMPLATES: ToolTemplate[] = [WEATHER_TEMPLATE, SEARCH_TEMPLATE]

/** 应用模板：预填描述与 schema（config 保留模板值，用户手改 URL） */
export function applyTemplate(tool: ToolCreateRequest, template: ToolTemplate): ToolCreateRequest {
  return {
    ...tool,
    description: tool.description || template.description,
    config: tool.config ?? template.config,
    schema: tool.schema &&
      Object.keys(tool.schema).length > 0
      ? tool.schema
      : template.schema,
  }
}