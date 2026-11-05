/**
 * 联网搜索适配层
 *
 * 免费引擎实现移植自 dsh-free-search（https://github.com/DDDMUC/dsh-free-search，MIT License），
 * 按其源码 lib/index.js 中的 bing / ddg / ddg-lite / searxng / anysearch / tavily(keyless)
 * 六个免 key 引擎原样移植端点、解析正则、反爬检测与重试策略。
 * 适配差异：网络请求统一走 @tauri-apps/plugin-http 的 fetch（绕过 WebView CORS，capability 已放行 https://**）。
 *
 * 该模块仅在设置中显式开启联网搜索时才会发起任何网络请求。
 */

export type SearchEngine = 'bing' | 'ddg' | 'ddg-lite' | 'searxng' | 'anysearch' | 'tavily'

export interface WebSearchSettings {
  /** 总开关，默认关闭 */
  enabled: boolean
  /** 首选引擎（实际失败时按回退链自动换引擎） */
  engine: SearchEngine
  /** 仅 Tavily 需要；留空走 keyless 匿名额度 */
  apiKey: string
  /** 返回给模型的最大结果数 */
  maxResults: number
  /** 单次 HTTP 请求超时（秒） */
  timeoutSeconds: number
  /** SearXNG 自定义实例列表（逗号/换行分隔，空则用内置公网池） */
  searxngInstances: string
}

export interface SearchResult {
  url: string
  title?: string
  snippet?: string
}

export interface SearchResponse {
  sources: SearchResult[]
  /** 实际生效的引擎（回退后可能与首选不同） */
  engine: SearchEngine
  /** 发生回退时的说明，如 "ddg failed, using bing." */
  fallbackNote?: string
}

// 上游常量：UA / Accept-Language / 端点
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
const ACCEPT_LANG = 'zh-CN,zh;q=0.9,en;q=0.8'

const DDG_HTML_URL = 'https://html.duckduckgo.com/html/'
const DDG_LITE_URL = 'https://lite.duckduckgo.com/lite/'
const BING_URL = 'https://www.bing.com/search'
const TAVILY_URL = 'https://api.tavily.com/search'
const ANYSEARCH_URL = 'https://api.anysearch.com/v1/search'

// 上游内置 SearXNG 公网实例池
const SEARXNG_INSTANCES = [
  'https://opnxng.com',
  'https://priv.au',
  'https://searx.be',
  'https://searx.tiekoetter.com',
  'https://search.inetol.net',
  'https://paulgo.io'
]

// 回退链顺序（与上游默认优先级一致：bing 最稳定 → ddg → searxng → anysearch → tavily keyless）
const FALLBACK_ORDER: SearchEngine[] = ['bing', 'ddg', 'ddg-lite', 'searxng', 'anysearch', 'tavily']

type FetchLike = (input: string, init?: Record<string, unknown>) => Promise<Response>

// 测试注入口：单元测试通过 setFetchForTest 注入 mock，不依赖真实网络与 Tauri 运行时
let fetchOverride: FetchLike | null = null
export function setFetchForTest(f: FetchLike | null): void {
  fetchOverride = f
}

async function getFetch(): Promise<FetchLike> {
  if (fetchOverride) return fetchOverride
  const { fetch } = await import('@tauri-apps/plugin-http')
  return fetch as unknown as FetchLike
}

function timeoutMs(cfg: WebSearchSettings): number {
  const s = Number(cfg.timeoutSeconds)
  return (Number.isFinite(s) && s > 0 ? s : 12) * 1000
}

function maxResultsOf(cfg: WebSearchSettings): number {
  const n = Number(cfg.maxResults)
  return Number.isFinite(n) && n > 0 ? Math.min(n, 10) : 5
}

//#region HTML 工具函数（移植自上游）

function decodeEntities(text: string): string {
  return String(text)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
}

function stripTags(html: string): string {
  return decodeEntities(String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
}

function extractDdgUrl(rel?: string): string | null {
  if (!rel) return null
  const m = rel.match(/uddg=([^&]+)/)
  if (m) {
    try {
      return decodeURIComponent(m[1])
    } catch {
      return m[1]
    }
  }
  if (rel.startsWith('//')) return `https:${rel}`
  return rel
}

function uniqueSources(sources: SearchResult[], limit: number): SearchResult[] {
  const seen = new Set<string>()
  const out: SearchResult[] = []
  for (const s of sources) {
    if (s.url && !seen.has(s.url)) {
      seen.add(s.url)
      out.push(s)
    }
    if (out.length >= limit) break
  }
  return out
}

function cleanSnippet(text: string | undefined, max = 300): string | undefined {
  if (!text) return text
  return String(text).replace(/\s+/g, ' ').trim().slice(0, max)
}

// Bing 无结果时会返回无关的缓存页（上游 issue #38）：用查询 token 与结果文本的重叠度识别。
// token 规则：CJK 取 1-2 字组合，拉丁/数字取长度 >=2 的词。
function queryOverlapTokens(query: string): string[] {
  const tokens = new Set<string>()
  for (const run of String(query).match(/[\u4e00-\u9fff]+/g) ?? []) {
    if (run.length <= 2) tokens.add(run)
    for (let i = 0; i + 1 < run.length; i++) tokens.add(run.slice(i, i + 2))
  }
  for (const word of String(query).toLowerCase().split(/[^a-z0-9]+/)) {
    if (word.length >= 2) tokens.add(word)
  }
  return [...tokens]
}

function looksRelevant(query: string, sources: SearchResult[]): boolean {
  const tokens = queryOverlapTokens(query)
  if (tokens.length === 0) return true
  return sources.some(s => {
    const hay = `${s.title ?? ''} ${s.snippet ?? ''} ${s.url ?? ''}`.toLowerCase()
    return tokens.some(t => hay.includes(t.toLowerCase()))
  })
}

//#endregion

//#region 底层抓取（含反爬检测与重试，移植自上游 fetchHtml / fetchHtmlWithRetry）

async function fetchRaw(url: string, init: Record<string, unknown>, ms: number, signal?: AbortSignal): Promise<Response> {
  const doFetch = await getFetch()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort)
  try {
    return await doFetch(url, { ...init, signal: controller.signal })
  } catch (error: any) {
    if (signal?.aborted) throw error
    throw new Error(`connection error: ${error?.message ?? String(error)}`)
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

async function fetchHtml(url: string, ms: number, signal?: AbortSignal, acceptLang = ACCEPT_LANG): Promise<string> {
  const response = await fetchRaw(
    url,
    { headers: { 'user-agent': USER_AGENT, 'accept-language': acceptLang }, redirect: 'follow' },
    ms,
    signal
  )
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url.split('?')[0]}`)
  }
  const html = await response.text()
  // DuckDuckGo 反爬验证页检测（HTTP 202 或验证关键字）
  if (response.status === 202 || /anomaly|captcha|unusual traffic|robot check/i.test(html.slice(0, 4000))) {
    throw new Error('DuckDuckGo is rate-limited right now (anti-bot challenge)')
  }
  return html
}

// 网络错误/空响应时重试，间隔 1.5s，最多 3 次（上游一致）
async function fetchHtmlWithRetry(url: string, ms: number, signal?: AbortSignal): Promise<string> {
  let lastError: Error | undefined
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const html = await fetchHtml(url, ms, signal)
      if (html.length > 500) return html
      lastError = new Error(`empty response (${html.length} bytes)`)
    } catch (error: any) {
      if (signal?.aborted) throw error
      lastError = error
    }
    if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 1500))
  }
  throw lastError ?? new Error('fetch failed')
}

//#endregion

//#region 各引擎实现（移植自上游 searchBing / searchDdgHtml / searchDdgLite / searchSearxng / searchAnysearch / searchTavily）

async function searchBing(query: string, max: number, cfg: WebSearchSettings, signal?: AbortSignal): Promise<SearchResult[]> {
  const params = new URLSearchParams({ q: query, mkt: 'zh-CN', adlt: 'off' })
  const html = await fetchHtmlWithRetry(`${BING_URL}?${params}`, timeoutMs(cfg), signal)
  const blocks = html.match(/<li class="b_algo"[\s\S]*?<\/li>/g) ?? []
  const sources: SearchResult[] = []
  for (const block of blocks) {
    const hrefMatch = block.match(/<a[^>]*href="(https?:\/\/[^"]+)"/)
    const titleMatch = block.match(/<h2[^>]*>[\s\S]*?<a[^>]*>(.*?)<\/a>[\s\S]*?<\/h2>/)
    const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/)
    if (!hrefMatch) continue
    sources.push({
      url: hrefMatch[1],
      ...(titleMatch ? { title: stripTags(titleMatch[1]) } : {}),
      ...(snippetMatch ? { snippet: cleanSnippet(stripTags(snippetMatch[1])) } : {})
    })
  }
  // 缓存垃圾页判定为 0 结果，交给回退链换引擎
  if (sources.length > 0 && !looksRelevant(query, sources)) return []
  return uniqueSources(sources, max)
}

async function searchDdgHtml(query: string, max: number, cfg: WebSearchSettings, signal?: AbortSignal): Promise<SearchResult[]> {
  const params = new URLSearchParams({ q: query, adlt: '-1' })
  const html = await fetchHtmlWithRetry(`${DDG_HTML_URL}?${params}`, timeoutMs(cfg), signal)
  const blocks = html.match(/<div class="result results_links[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/g) ?? []
  const sources: SearchResult[] = []
  for (const block of blocks) {
    const urlMatch = block.match(/<a[^>]*class="result__a"[^>]*href="([^"]*)"/)
    const titleMatch = block.match(/<a[^>]*class="result__a"[^>]*>(.*?)<\/a>/)
    const snippetMatch = block.match(/<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/)
    const url = extractDdgUrl(urlMatch?.[1])
    if (!url) continue
    sources.push({
      url,
      ...(titleMatch ? { title: stripTags(titleMatch[1]) } : {}),
      ...(snippetMatch ? { snippet: cleanSnippet(stripTags(snippetMatch[1])) } : {})
    })
  }
  return uniqueSources(sources, max)
}

async function searchDdgLite(query: string, max: number, cfg: WebSearchSettings, signal?: AbortSignal): Promise<SearchResult[]> {
  const params = new URLSearchParams({ q: query, adlt: '-1' })
  const html = await fetchHtmlWithRetry(`${DDG_LITE_URL}?${params}`, timeoutMs(cfg), signal)
  const linkMatches = html.match(/<a[^>]*class=['"]result-link['"][^>]*>[\s\S]*?<\/a>/g) ?? []
  const snippetMatches = html.match(/class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/g) ?? []
  const sources: SearchResult[] = []
  for (let i = 0; i < linkMatches.length; i++) {
    const tag = linkMatches[i]
    const hrefMatch = tag.match(/href="([^"]*)"/)
    const titleMatch = tag.match(/class=['"]result-link['"][^>]*>(.*?)<\/a>/)
    if (!hrefMatch) continue
    const url = extractDdgUrl(hrefMatch[1])
    if (!url) continue
    const snippet = snippetMatches[i]?.match(/class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/)?.[1]
    sources.push({
      url,
      ...(titleMatch ? { title: stripTags(titleMatch[1]) } : {}),
      ...(snippet ? { snippet: cleanSnippet(stripTags(snippet)) } : {})
    })
  }
  return uniqueSources(sources, max)
}

function resolveSearxngInstances(cfg: WebSearchSettings): string[] {
  const custom = String(cfg.searxngInstances ?? '')
    .split(/[,\n]/)
    .map(s => s.trim())
    .filter(Boolean)
  return custom.length > 0 ? custom : SEARXNG_INSTANCES
}

async function searchSearxng(query: string, max: number, cfg: WebSearchSettings, signal?: AbortSignal): Promise<SearchResult[]> {
  const instances = resolveSearxngInstances(cfg)
  const errors: string[] = []
  for (const base of instances) {
    try {
      const params = new URLSearchParams({ q: query, format: 'json' })
      const response = await fetchRaw(
        `${base.replace(/\/+$/, '')}/search?${params}`,
        { headers: { 'user-agent': USER_AGENT, accept: 'application/json' } },
        timeoutMs(cfg),
        signal
      )
      if (!response.ok) {
        errors.push(`${base}: HTTP ${response.status}`)
        continue
      }
      const data = await response.json().catch(() => null)
      if (!data || !Array.isArray(data.results)) {
        errors.push(`${base}: invalid JSON`)
        continue
      }
      const sources: SearchResult[] = data.results
        .filter((r: any) => r.url)
        .map((r: any) => ({
          url: String(r.url),
          ...(r.title ? { title: String(r.title) } : {}),
          ...(r.content ? { snippet: cleanSnippet(String(r.content)) } : {})
        }))
      if (sources.length > 0) return uniqueSources(sources, max)
      errors.push(`${base}: 0 results`)
    } catch (error: any) {
      if (signal?.aborted) throw error
      errors.push(`${base}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  throw new Error(`all SearXNG instances failed: ${errors.join(', ').slice(0, 300)}`)
}

async function searchAnysearch(query: string, max: number, cfg: WebSearchSettings, signal?: AbortSignal): Promise<SearchResult[]> {
  // 匿名公共额度，无需 key（上游行为；ZError 暂不为其配置 key）
  const response = await fetchRaw(
    ANYSEARCH_URL,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, max_results: max })
    },
    timeoutMs(cfg),
    signal
  )
  if (!response.ok) throw new Error(`AnySearch API error (HTTP ${response.status})`)
  const data = await response.json()
  if (data.code !== 0) throw new Error(`AnySearch API error: ${data.message ?? data.code}`)
  const results = data.data?.results ?? []
  return results
    .filter((r: any) => r.url)
    .map((r: any) => ({
      url: String(r.url),
      ...(r.title ? { title: String(r.title) } : {}),
      ...(r.snippet ? { snippet: cleanSnippet(String(r.snippet)) } : {})
    }))
}

async function searchTavily(query: string, max: number, cfg: WebSearchSettings, signal?: AbortSignal): Promise<SearchResult[]> {
  const apiKey = String(cfg.apiKey ?? '').trim()
  const response = await fetchRaw(
    TAVILY_URL,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : { 'x-tavily-access-mode': 'keyless' })
      },
      body: JSON.stringify({ query, max_results: Math.min(max, 20), search_depth: 'basic' }),
      redirect: 'error'
    },
    timeoutMs(cfg),
    signal
  )
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    if (response.status === 401) throw new Error('Tavily API key is invalid (HTTP 401)')
    throw new Error(`Tavily API error (HTTP ${response.status}): ${detail.slice(0, 200)}`)
  }
  const data = await response.json()
  const sources: SearchResult[] = (data.results ?? [])
    .filter((r: any) => r.url)
    .map((r: any) => ({
      url: String(r.url),
      ...(r.title ? { title: String(r.title) } : {}),
      ...(r.content ? { snippet: cleanSnippet(String(r.content)) } : {})
    }))
  return uniqueSources(sources, max)
}

//#endregion

const ENGINE_IMPL: Record<SearchEngine, (q: string, max: number, cfg: WebSearchSettings, signal?: AbortSignal) => Promise<SearchResult[]>> = {
  bing: searchBing,
  ddg: searchDdgHtml,
  'ddg-lite': searchDdgLite,
  searxng: searchSearxng,
  anysearch: searchAnysearch,
  tavily: searchTavily
}

/**
 * 统一搜索入口：首选引擎 → 其余免费引擎逐个回退。
 * 全部失败时抛出聚合错误；调用方（工具执行器）负责把失败转为给模型的提示文本。
 */
export async function webSearch(query: string, cfg: WebSearchSettings, signal?: AbortSignal): Promise<SearchResponse> {
  const q = String(query ?? '').trim()
  if (!q) throw new Error('empty query')

  const preferred: SearchEngine = ENGINE_IMPL[cfg.engine] ? cfg.engine : 'bing'
  const order = [preferred, ...FALLBACK_ORDER.filter(e => e !== preferred)]
  const max = maxResultsOf(cfg)
  const errors: string[] = []

  for (let i = 0; i < order.length; i++) {
    const engine = order[i]
    try {
      const sources = await ENGINE_IMPL[engine](q, max, cfg, signal)
      if (sources.length > 0) {
        return {
          sources,
          engine,
          ...(i > 0 ? { fallbackNote: `${order.slice(0, i).join(', ')} failed, using ${engine}.` } : {})
        }
      }
      errors.push(`${engine}: 0 results`)
    } catch (error: any) {
      if (signal?.aborted) throw error
      errors.push(`${engine}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  throw new Error(`all search engines failed: ${errors.join(' | ').slice(0, 400)}`)
}

//#region OpenAI 工具定义与结果格式化

/** 注入 chat/completions 的 web_search 工具 schema（OpenAI function calling 格式） */
export const WEB_SEARCH_TOOL = {
  type: 'function',
  function: {
    name: 'web_search',
    description:
      '联网搜索工具。当题目涉及时效性信息、你不确定的事实、或需要外部资料佐证时调用。返回带 URL 的搜索结果列表。',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '搜索关键词（题目核心内容，去掉选项文本与题号）'
        }
      },
      required: ['query']
    }
  }
}

/** 注入模型的最大结果条数：过多结果反而稀释注意力、带偏答案 */
const MAX_INJECTED_RESULTS = 3
/** 单条摘要最大长度，避免无关长文占用上下文 */
const MAX_SNIPPET_CHARS = 300

/** 把搜索结果格式化为回传给模型的 tool content（带编号来源；来源仅供判断可信度，禁止抄进答案） */
export function formatSearchResultsForModel(resp: SearchResponse): string {
  const kept = resp.sources.slice(0, MAX_INJECTED_RESULTS)
  const lines = kept.map((s, i) => {
    const title = s.title ? s.title : s.url
    const rawSnippet = s.snippet || ''
    const snippet = rawSnippet
      ? `\n${rawSnippet.length > MAX_SNIPPET_CHARS ? `${rawSnippet.slice(0, MAX_SNIPPET_CHARS)}…` : rawSnippet}`
      : ''
    return `[${i + 1}] ${title} (${s.url})${snippet}`
  })
  const header = `联网搜索结果（引擎: ${resp.engine}）${resp.fallbackNote ? ` [${resp.fallbackNote}]` : ''}:`
  return `${header}\n${lines.join('\n')}\n请以你自身的知识为主作答，搜索结果仅作补充与校验：仅采用与题干直接相关的结果，无关内容直接忽略；若结果与题干事实或学科常识冲突，以题干与常识为准。以上网址仅供你判断可信度，严禁抄进答案：answer 只写答案正文，不得包含来源说明、网址或链接（答案会被直接判分，链接会导致判分失败），也不要输出 SOURCES 等附加行。`
}

/**
 * 工具调用执行入口：解析模型给出的 arguments，执行搜索并返回 tool content 字符串。
 * 搜索全链失败时不抛错（避免中断答题），而是返回失败说明让模型凭自身知识作答；
 * 仅当请求被用户取消（abort）时向上抛出。
 */
export async function executeWebSearchToolCall(argsJson: string, cfg: WebSearchSettings, signal?: AbortSignal): Promise<string> {
  let query = ''
  let parseFailed = false
  try {
    const parsed = JSON.parse(argsJson || '{}')
    query = String(parsed.query ?? '').trim()
  } catch {
    parseFailed = true
  }
  // 兜底：流式分片拼接异常（片段重复、截断）时，直接从原始参数里提取 query 值
  if (!query && argsJson) {
    const m = /"query"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(argsJson)
    if (m) {
      try {
        query = (JSON.parse(`"${m[1]}"`) as string).trim()
      } catch {
        query = m[1].trim()
      }
    }
  }
  // 模型有时只发出空参数或半个 JSON：给出明确指引让它重试，而不是用空关键词去搜索
  if (!query) {
    return parseFailed
      ? 'Error: invalid tool arguments (expect {"query": "..."}). 请重新调用 web_search 并通过 JSON 参数传入 query 字段。'
      : 'Error: missing "query" argument. 请重新调用 web_search，参数格式为 {"query": "题目核心关键词"}。'
  }
  try {
    const resp = await webSearch(query, cfg, signal)
    return formatSearchResultsForModel(resp)
  } catch (error: any) {
    if (signal?.aborted) throw error
    return `搜索失败: ${error instanceof Error ? error.message : String(error)}。请基于你自身的知识直接作答。`
  }
}

//#endregion
