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
  /** 诊断：供应商 output.total 报告的总数（仅原生端点有） */
  total?: number
  /** 诊断：被能力标签过滤掉（生图/TTS/向量等非对话）的条数 */
  filteredOut?: number
}

const VISION_CODES = new Set(['VU', 'Multimodal-Omni', 'Realtime-Omni'])
const CHAT_CODES = new Set(['TG', 'VU', 'Reasoning', 'Multimodal-Omni', 'Realtime-Omni', 'Realtime-Chatting'])

/** 首选每页条数。服务端可能按自身上限截断（文档默认 20），实际值以响应 output.page_size 为准。 */
const PAGE_SIZE = 100
/** 超限被服务端拒绝时使用的保守页大小（文档默认值） */
const MIN_PAGE_SIZE = 20
/** 翻页硬上限，防止服务端忽略 page_no 时空转（5000 个模型足够） */
const MAX_MODEL_PAGES = 50

/** 名称启发式，仅在无能力标签时使用 */
export const guessCategory = (id: string): ModelCategory => {
  const s = String(id || '').toLowerCase()
  if (/vision|-vl|vl-|-4v|4v-|-v[0-9]|image|omni|[0-9]v(?:-|$)/.test(s)) return 'vision'
  return 'text'
}

const normalizeKey = (id: string): string =>
  String(id || '').trim().toLowerCase().replace(/^cmaas-/, '')

/** 单个百炼模型对象 → FetchedModel；非对话模型 / 无能力标签返回 null */
const parseNativeItem = (item: any): FetchedModel | null => {
  const id = String(item?.model || item?.id || '').trim()
  if (!id) return null
  const caps: string[] = Array.isArray(item?.capabilities)
    ? item.capabilities.map(String)
    : []
  // 没有能力标签就没法判断能否对话，按「无法归类」跳过，由调用方计数上报
  if (caps.length === 0) return null
  // 只保留可对话的模型：TG / VU / Reasoning / Omni 等；
  // IG（文生图）、TTS、ASR、TR（向量/排序）不是答题模型，不拉取
  if (!caps.some(c => CHAT_CODES.has(c))) return null
  return {
    id,
    category: caps.some(c => VISION_CODES.has(c)) ? 'vision' : 'text',
    source: 'native',
    capabilities: caps
  }
}

/** 解析百炼原生响应；结构不符返回 null 由调用方回退 */
export const parseNativeModels = (json: unknown): FetchedModel[] | null => {
  const list = (json as any)?.output?.models
  if (!Array.isArray(list) || list.length === 0) return null
  const result = list
    .map(item => parseNativeItem(item))
    .filter((model): model is FetchedModel => model !== null)
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

/**
 * 生成候选 URL 列表。
 *
 * 百炼的 Base URL 有多种写法，路径部分各不相同：
 *   .../compatible-mode          （OpenAI 兼容）
 *   .../compatible-mode/v1
 *   .../apps/anthropic           （Anthropic 兼容）
 * 而模型列表只有两个真实位置：
 *   原生（带 capabilities）：{origin}/api/v1/models
 *   兼容（仅 id）：{base}/v1/models 或 {base}/models
 * 之前按后缀替换推导，遇到 /apps/anthropic 会把路径拼成
 * /apps/anthropic/api/v1/models（已实测 404）。故改用 URL.origin 取主机根。
 */
const resolveUrls = (baseUrl: string): { origin: string; base: string; hasV1: boolean } => {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '')
  let origin = ''
  try {
    origin = new URL(base).origin
  } catch {
    // base 不是合法 URL 时退回字符串截取（去掉已知路径后缀）
    origin = base.replace(/\/(compatible-mode|apps\/anthropic|apps\/\w+)(\/v1)?$/i, '')
  }
  return { origin, base, hasV1: /\/v1$/i.test(base) }
}

const tryFetchModels = async (
  fetchFn: typeof fetch,
  urls: string[],
  headers: Record<string, string>,
  parse: (json: unknown) => FetchedModel[] | null,
  signal?: AbortSignal
): Promise<{ models: FetchedModel[] | null; statuses: string[] }> => {
  const statuses: string[] = []
  for (const url of urls) {
    try {
      const resp = await fetchFn(url, { headers, signal })
      if (!resp.ok) {
        statuses.push(`${new URL(url).pathname} → HTTP ${resp.status}`)
        continue
      }
      const parsed = parse(await resp.json())
      if (parsed) return { models: parsed, statuses }
      statuses.push(`${new URL(url).pathname} → 结构不符`)
    } catch (e) {
      statuses.push(`${url.replace(/\?.*$/, '')} → ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return { models: null, statuses }
}

const getFetch = async (): Promise<typeof fetch> => {
  try {
    // 优先 Tauri 安全通道（支持凭据引用与跨域）
    return secureFetch
  } catch {
    return globalThis.fetch.bind(globalThis)
  }
}

/**
 * 拉取模型列表：先试百炼原生端点拿 capabilities，失败回退 OpenAI 兼容端点。
 *
 * 原生端点分页拉取：百炼账号下常有 300+ 模型，单页 100 会漏掉大半，
 * 表现为「能拉取但模型数量明显偏少」。最多 10 页（1000 个）后停止。
 *
 * @param baseUrl 平台 Base URL（如 https://xxx.cn-beijing.maas.aliyuncs.com/compatible-mode）
 * @param apiKey  API Key
 */
export const fetchBailianModels = async (
  baseUrl: string,
  apiKey: string,
  signal?: AbortSignal
): Promise<FetchModelsResult> => {
  const fetchFn = await getFetch()
  const key = String(apiKey || '').trim()
  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    // 部分 Anthropic 兼容端点只认 x-api-key；同时带上两种，兼容性更好
    'x-api-key': key,
    'Content-Type': 'application/json'
  }

  const { origin, base, hasV1 } = resolveUrls(baseUrl)
  const statuses: string[] = []

  // ---- 原生端点：翻页拉全 ----
  // 终止条件必须看 output.total。服务端会把 page_size 截断到自身上限（文档默认 20），
  // 若按「本页不满 page_size 即末页」判断，第一页就停 → 只能拉到第一页，模型明显偏少。
  const collected = new Map<string, FetchedModel>()
  let total: number | undefined
  let serverPageSize: number | undefined
  let filteredOut = 0
  let nativeReachable = false
  let pageSize = PAGE_SIZE
  let downgraded = false
  for (let pageNo = 1; pageNo <= MAX_MODEL_PAGES; pageNo++) {
    const url = `${origin}/api/v1/models?page_no=${pageNo}&page_size=${pageSize}`
    try {
      const resp = await fetchFn(url, { headers, signal })
      if (!resp.ok) {
        // 部分工作空间对 page_size 超限直接 400，而不是静默截断：降到 20 重试本页
        if (!downgraded && [400, 413, 422].includes(resp.status)) {
          downgraded = true
          pageSize = MIN_PAGE_SIZE
          pageNo -= 1
          continue
        }
        statuses.push(`${new URL(url).pathname} → HTTP ${resp.status}`)
        break
      }
      nativeReachable = true
      const json = await resp.json()
      const out = (json as any)?.output
      const raw = out?.models
      if (typeof out?.total === 'number' && Number.isFinite(out.total)) total = out.total
      if (typeof out?.page_size === 'number' && out.page_size > 0) serverPageSize = out.page_size
      if (!Array.isArray(raw) || raw.length === 0) break

      const before = collected.size
      for (const item of raw) {
        const model = parseNativeItem(item)
        if (!model) {
          filteredOut += 1
          continue
        }
        if (!collected.has(model.id)) collected.set(model.id, model)
      }

      const perPage = serverPageSize || raw.length
      // total 是权威终止条件
      if (total !== undefined && pageNo * perPage >= total) break
      // 没有 total 时退回「本页不足一页」
      if (raw.length < perPage) break
      // 服务端忽略 page_no（每页返回同一批）时避免无意义空转
      if (pageNo > 1 && collected.size === before) break
    } catch (e) {
      statuses.push(`${new URL(url).pathname} → ${e instanceof Error ? e.message : String(e)}`)
      break
    }
  }
  if (collected.size > 0) {
    return { models: [...collected.values()], endpoint: 'native', total, filteredOut }
  }
  if (nativeReachable) {
    statuses.push(`原生端点可访问（供应商共 ${total ?? '未知'} 个模型），但没有可对话模型或响应结构不符`)
  }

  // ---- 回退：OpenAI 兼容端点 ----
  const compatibleCandidates = hasV1 ? [`${base}/models`] : [`${base}/v1/models`, `${base}/models`]
  const compatibleTry = await tryFetchModels(fetchFn, compatibleCandidates, headers, parseCompatibleModels, signal)
  if (compatibleTry.models) {
    return {
      models: compatibleTry.models,
      endpoint: 'compatible',
      error: statuses.length ? `原生端点不可用（${statuses.join('；')}）` : undefined
    }
  }

  return {
    models: [],
    endpoint: 'compatible',
    error: `全部端点失败 — 原生：${statuses.join('；') || '无响应'}；兼容：${compatibleTry.statuses.join('；') || '无响应'}`
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
