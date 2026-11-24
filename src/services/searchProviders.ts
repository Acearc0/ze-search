export const SEARCH_PROVIDERS = [
  // 免费引擎：无需 API Key，由模型通过 function call 按需触发（见 freeWebSearch.ts）
  { id: 'free', name: '免费引擎（免 Key）', key: 'apiKey', website: '', toolName: 'web_search' },
  // 百炼内置联网：不注入工具、不做预搜，直接给模型请求加 enable_search，由服务端完成联网。
  // 不需要额外 Key（复用模型平台的 Key），但只有 Qwen 系列支持该参数。
  { id: 'bailian', name: '阿里云百炼（内置联网）', key: 'apiKey', website: 'https://help.aliyun.com/zh/model-studio/web-search', toolName: 'enable_search' },
  { id: 'exa', name: 'Exa', key: 'apiKey', website: 'https://exa.ai/', toolName: 'web_search_exa' },
  { id: 'deepseek', name: 'DeepSeek', key: 'deepseekApiKey', website: 'https://api-docs.deepseek.com/', toolName: 'deepseek_search' },
  { id: 'tavily', name: 'Tavily', key: 'tavilyApiKey', website: 'https://www.tavily.com/', toolName: 'tavily_search' },
  { id: 'brave', name: 'Brave Search', key: 'braveApiKey', website: 'https://brave.com/search/api/', toolName: 'brave_search' },
  { id: 'you', name: 'You.com', key: 'youApiKey', website: 'https://you.com/', toolName: 'you_search' },
] as const

export type SearchProvider = typeof SEARCH_PROVIDERS[number]
export type SearchProviderId = SearchProvider['id']
type SearchApiKeyField = SearchProvider['key']

export const getSearchProvider = (id: unknown): SearchProvider =>
  SEARCH_PROVIDERS.find(provider => provider.id === id) ?? SEARCH_PROVIDERS[0]

/** 联网搜索设置，连接参数由软件管理。 */
export interface SearchSettings extends Partial<Record<SearchApiKeyField, string>> {
  enabled: boolean
  apiKey: string
  provider?: SearchProviderId
}

export const DEFAULT_SEARCH_SETTINGS: SearchSettings = {
  enabled: true,
  apiKey: '',
  provider: 'exa',
  deepseekApiKey: '',
}

export const normalizeSearchSettings = (value: unknown): SearchSettings => {
  const saved = value && typeof value === 'object' ? value as Partial<SearchSettings> : {}
  const search: SearchSettings = {
    ...DEFAULT_SEARCH_SETTINGS,
    enabled: typeof saved.enabled === 'boolean' ? saved.enabled : DEFAULT_SEARCH_SETTINGS.enabled,
    provider: getSearchProvider(saved.provider).id,
  }
  for (const { key } of SEARCH_PROVIDERS) {
    const credential = saved[key]
    if (typeof credential === 'string') search[key] = credential.trim()
  }
  return search
}
