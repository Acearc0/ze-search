/**
 * 从供应商 API 拉取模型列表。
 *
 * 主路径：阿里云百炼 DashScope 原生 `GET /api/v1/models`，
 * 返回 capabilities（TG/VU/Reasoning/IG...），可精确区分文本/视觉/生图。
 * 回退路径：OpenAI 兼容 `GET /compatible-mode/v1/models`，只有 id，无能力信息，
 * 此时用模型名启发式分类（并在结果里标记推断来源）。
 *
 * 使用 @tauri-apps/plugin-http 的 fetch 绕过 WebView CORS；
 * 非 Tauri 环境回退到全局 fetch（便于测试与浏览器预览）。
 */

import { secureFetch } from '../security/secureFetch'

export type ModelCategory = 'text' | 'vision' | 'summary'

export interface FetchedModel {
  id: string
  category: ModelCategory
  /** 能力源：native=供应商能力标签权威分类，guess=名称推断 */
  source: 'native' | 'guess'
  capabilities: string[]
}

export interface FetchModelsResult {
  models: FetchedModel[]
  /** 实际使用的端点类型 */
  endpoint: 'native' | 'compatible'
  error?: string
}

const VISION_CODES = new Set(['VU', 'Multimodal-Omni', 'Realtime-Omni'])
const CHAT_CODES = new Set(['TG', 'VU', 'Reasoning', 'Multimodal-Omni', 'Realtime-Omni', 'Realtime-Chatting'])

/** 名称启发式，仅在无能力标签时使用 */
export const guessCategory = (id: string): ModelCategory => {
  const s = String(id || '').toLowerCase()
  if (/vision|-vl|vl-|-4v|4v-|-v[0-9]|image|omni|[0-9]v(?:-|$)/.test(s)) return 'vision'
  return 'text'
}

const normalizeKey = (id: string): string =>
  String(id || '').trim().toLowerCase().replace(/^cmaas-/, '')

/** 解析百炼原生响应；结构不符返回 null 由调用方回退 */
export const parseNativeModels = (json: unknown): FetchedModel[] | null => {
  const list = (json as any)?.output?.models
  if (!Array.isArray(list) || list.length === 0) return null
  const result: FetchedModel[] = []
  for (const item of list) {
    const id = String(item?.model || item?.id || '').trim()
    if (!id) continue
    const caps: string[] = Array.isArray(item?.capabilities)
      ? item.capabilities.map(String)
      : []
    if (caps.length === 0) continue
    // 只保留可对话的模型：TG / VU / Reasoning / Omni 等；
    // IG（文生图）、TTS、ASR、TR（向量/排序）不是答题模型，不拉取
    if (!caps.some(c => CHAT_CODES.has(c))) continue
    result.push({
      id,
      category: caps.some(c => VISION_CODES.has(c)) ? 'vision' : 'text',
      source: 'native',
      capabilities: caps
    })
  }
  return result.length ? result : null
}

/** 解析 OpenAI 兼容响应（只有 id） */
export const parseCompatibleModels = (json: unknown): FetchedModel[] | null => {
  const list = (json as any)?.data
  if (!Array.isArray(list) || list.length === 0) return null
  const result: FetchedModel[] = []
  for (const item of list) {
    const id = String(item?.id || '').trim()
    if (!id) continue
    result.push({ id, category: guessCategory(id), source: 'guess', capabilities: [] })
  }
  return result.length ? result : null
}

const joinUrl = (base: string, path: string): string =>
  `${String(base || '').replace(/\/+$/, '')}${path}`

const getFetch = async (): Promise<typeof fetch> => {
  try {
    // 优先 Tauri 安全通道（支持凭据引用与跨域）
    return secureFetch
  } catch {
    return globalThis.fetch.bind(globalThis)
  }
}

/**
 * 拉取百炼模型列表：先试原生端点拿 capabilities，失败回退兼容端点。
 * @param baseUrl 平台 Base URL（如 https://xxx.cn-beijing.maas.aliyuncs.com/compatible-mode）
 * @param apiKey  API Key
 */
export const fetchBailianModels = async (
  baseUrl: string,
  apiKey: string,
  signal?: AbortSignal
): Promise<FetchModelsResult> => {
  const fetchFn = await getFetch()
  const base = String(baseUrl || '').trim()
  const key = String(apiKey || '').trim()
  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json'
  }

  // 百炼原生端点：把 /compatible-mode 换成 /api/v1
  const nativeBase = base.replace(/\/compatible-mode\/?$/, '') || base
  const nativeUrl = joinUrl(nativeBase, '/api/v1/models?page_no=1&page_size=200')

  let nativeError = ''
  try {
    const resp = await fetchFn(nativeUrl, { headers, signal })
    if (resp.ok) {
      const parsed = parseNativeModels(await resp.json())
      if (parsed) return { models: parsed, endpoint: 'native' }
      nativeError = '原生端点返回结构不符'
    } else {
      nativeError = `原生端点 HTTP ${resp.status}`
    }
  } catch (e) {
    nativeError = e instanceof Error ? e.message : String(e)
  }

  // 回退：OpenAI 兼容端点
  const compatibleUrl = joinUrl(base, '/models')
  try {
    const resp = await fetchFn(compatibleUrl, { headers, signal })
    if (!resp.ok) throw new Error(`兼容端点 HTTP ${resp.status}`)
    const parsed = parseCompatibleModels(await resp.json())
    if (!parsed) throw new Error('兼容端点返回结构不符')
    return { models: parsed, endpoint: 'compatible', error: nativeError }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { models: [], endpoint: 'compatible', error: `${nativeError}；${msg}` }
  }
}

/** 对比已配置模型与拉取结果，给出新增/失效列表 */
export const diffFetchedModels = (
  fetched: FetchedModel[],
  existingIds: string[]
): { added: FetchedModel[]; expired: string[] } => {
  const existing = new Set(existingIds.map(normalizeKey))
  return {
    added: fetched.filter(m => !existing.has(normalizeKey(m.id))),
    expired: [...existing].filter(id => !fetched.some(m => normalizeKey(m.id) === id))
  }
}
