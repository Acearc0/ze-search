/**
 * webSearch 适配层单元测试（mock fetch，不依赖真实网络与 Tauri 运行时）
 * 运行：node --test tests/
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  setFetchForTest,
  webSearch,
  executeWebSearchToolCall,
  WEB_SEARCH_TOOL,
  type WebSearchSettings
} from '../src/services/webSearch.ts'

const baseCfg = (over: Partial<WebSearchSettings> = {}): WebSearchSettings => ({
  enabled: true,
  engine: 'bing',
  apiKey: '',
  maxResults: 5,
  timeoutSeconds: 5,
  searxngInstances: '',
  ...over
})

function mockResponse(status: number, body: string, contentType = 'text/html') {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    json: async () => JSON.parse(body)
  } as unknown as Response
}

type Handler = (url: string, init?: Record<string, unknown>) => Promise<unknown>

function installFetch(handler: Handler) {
  const calls: { url: string; init?: Record<string, unknown> }[] = []
  setFetchForTest(async (url: string, init?: Record<string, unknown>) => {
    calls.push({ url, init })
    return await handler(url, init) as Response
  })
  return calls
}

const PAD = 'p'.repeat(600)

test('bing：解析 b_algo 结果并做 HTML 实体解码', async () => {
  const bingHtml = `<html><body><ol id="b_results">
    <li class="b_algo"><h2><a href="https://ex.com/a">凸轮机构 传动角 定义</a></h2><p>传动角是压力角&amp;的余角。</p></li>
    <li class="b_algo"><h2><a href="https://ex.com/b">从动件运动规律</a></h2><p>取决于凸轮轮廓。</p></li>
  </ol>${PAD}</body></html>`
  installFetch(async () => mockResponse(200, bingHtml))

  const resp = await webSearch('凸轮机构中，从动件运动规律取决于（ ）。', baseCfg())
  assert.equal(resp.engine, 'bing')
  assert.equal(resp.sources.length, 2)
  assert.equal(resp.sources[0].url, 'https://ex.com/a')
  assert.equal(resp.sources[0].title, '凸轮机构 传动角 定义')
  assert.ok(resp.sources[0].snippet?.includes('&'))
  assert.equal(resp.fallbackNote, undefined)
})

test('ddg：解析 result__a 并解码 uddg 跳转链接', async () => {
  const ddgHtml = `<body>
    <div class="result results_links"><div><div><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fpage&amp;rut=abc">Example 标题</a><a class="result__snippet">摘要 &amp; 内容</a></div></div></div>
    ${PAD}
  </body>`
  installFetch(async () => mockResponse(200, ddgHtml))

  const resp = await webSearch('example 查询词', baseCfg({ engine: 'ddg' }))
  assert.equal(resp.engine, 'ddg')
  assert.equal(resp.sources[0].url, 'https://example.org/page')
  assert.equal(resp.sources[0].title, 'Example 标题')
  assert.equal(resp.sources[0].snippet, '摘要 & 内容')
})

test('回退链：searxng 全实例失败 + bing 返回无关缓存页 → 自动落到 ddg', async () => {
  const garbageBingHtml = `<html><body><ol>${
    '<li class="b_algo"><h2><a href="https://youtube.com/x">热门视频</a></h2><p>与本题完全无关的内容。</p></li>'
  }</ol>${PAD}</html>`
  const ddgHtml = `<body><div class="result results_links"><div><div><a class="result__a" href="https://good.example/q">有效结果</a><a class="result__snippet">s</a></div></div></div>${PAD}</body>`
  const calls = installFetch(async (url) => {
    if (url.includes('bing.com')) return mockResponse(200, garbageBingHtml)
    if (url.includes('duckduckgo.com/html')) return mockResponse(200, ddgHtml)
    throw new Error('ECONNREFUSED') // searxng 实例池全部拒连
  })

  const resp = await webSearch('凸轮机构 传动角', baseCfg({ engine: 'searxng' }))
  assert.equal(resp.engine, 'ddg')
  assert.ok(resp.fallbackNote?.includes('searxng'))
  assert.ok(resp.fallbackNote?.includes('bing'))
  assert.equal(resp.sources[0].url, 'https://good.example/q')
  assert.ok(calls.length > 6) // searxng 6 实例 + bing + ddg
})

test('tavily：无 key 走 keyless 头，有 key 走 Bearer', async () => {
  const tavilyBody = JSON.stringify({ results: [{ url: 'https://t1.example', title: 'T1', content: 'c1' }] })

  const calls1 = installFetch(async () => mockResponse(200, tavilyBody, 'application/json'))
  await webSearch('q', baseCfg({ engine: 'tavily' }))
  const headers1 = calls1[0].init?.headers as Record<string, string>
  assert.equal(headers1['x-tavily-access-mode'], 'keyless')
  assert.equal(headers1.authorization, undefined)

  const calls2 = installFetch(async () => mockResponse(200, tavilyBody, 'application/json'))
  await webSearch('q', baseCfg({ engine: 'tavily', apiKey: 'tvly-abc' }))
  const headers2 = calls2[0].init?.headers as Record<string, string>
  assert.equal(headers2.authorization, 'Bearer tvly-abc')
  assert.equal(headers2['x-tavily-access-mode'], undefined)
})

test('executeWebSearchToolCall：非法参数返回错误文本', async () => {
  installFetch(async () => { throw new Error('should not be called') })
  const out = await executeWebSearchToolCall('not-json', baseCfg())
  assert.ok(out.startsWith('Error: invalid tool arguments'))
})

test('executeWebSearchToolCall：搜索失败不抛错，返回提示模型凭知识作答', async () => {
  installFetch(async () => { throw new Error('network down') })
  const out = await executeWebSearchToolCall('{"query":"测试题目"}', baseCfg({ engine: 'tavily' }))
  assert.ok(out.startsWith('搜索失败'))
  assert.ok(out.includes('请基于你自身的知识直接作答'))
})

test('webSearch：空查询直接报错', async () => {
  installFetch(async () => mockResponse(200, ''))
  await assert.rejects(() => webSearch('   ', baseCfg()), /empty query/)
})

test('WEB_SEARCH_TOOL：schema 形状符合 OpenAI function calling', () => {
  assert.equal(WEB_SEARCH_TOOL.type, 'function')
  assert.equal(WEB_SEARCH_TOOL.function.name, 'web_search')
  assert.deepEqual(WEB_SEARCH_TOOL.function.parameters.required, ['query'])
})
