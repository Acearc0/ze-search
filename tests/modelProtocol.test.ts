/**
 * 模型参数约束表回归测试（mock fetch，不依赖真实网络与 Tauri 运行时）
 *
 * 覆盖两次线上报错的根因：
 *   - GLM-5.3 的 reasoning_effort 仅接受 low/high/max，传 medium 报 invalid_parameter_error
 *   - Kimi K3 的 temperature 固定 1.0、top_p 固定 0.95，传其他值报 400
 *
 * 运行：node tests/modelProtocol.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveExecutableModelJsCode,
  resolveModelParamConstraints,
  mapEffortToVocab
} from '../src/services/modelProtocol.ts'

type AnyModel = Parameters<typeof resolveExecutableModelJsCode>[0]

/** 执行预设协议生成的代码，返回实际发出的请求体 */
async function capturePayload(model: AnyModel, configOverride: Record<string, unknown> = {}) {
  const code = resolveExecutableModelJsCode(model)
  assert.ok(code, '应生成可执行调用代码')
  assert.ok(code.startsWith('async function'), '预设模板应为完整函数声明')

  const captured: { url: string; body: any }[] = []
  const mockFetch = async (url: string, init: any) => {
    captured.push({ url: String(url), body: JSON.parse(init.body) })
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      body: null,
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify({ choices: [{ message: { content: 'ok' } }] })
    }
  }

  const factory = new Function(
    'input', 'config', 'fetch', 'abortSignal',
    `${code}\nreturn processModel;`
  ) as () => (input: unknown, config: unknown, fetch: unknown, signal: unknown) => Promise<unknown>
  const processModel = factory()

  const config = {
    apiKey: 'test-key',
    baseUrl: 'https://api.example.com/v1',
    maxTokens: 4096,
    temperature: 0.7,
    topP: 1,
    modelId: model?.modelId,
    model: model?.modelId,
    ...configOverride
  }

  await processModel({ messages: [{ role: 'user', content: 'hi' }], stream: false }, config, mockFetch, undefined)

  assert.equal(captured.length, 1, '应发出一次请求')
  return captured[0].body
}

const chatModel = (modelId: string, over: Record<string, unknown> = {}): AnyModel => ({
  apiProtocol: 'openai-chat',
  modelId,
  enableThinking: true,
  thinkingEffort: 'medium',
  ...over
} as AnyModel)

// ---------- 约束表本身 ----------

test('约束表：命中 kimi-k3 时省略 temperature/top_p 且禁止关闭思考', () => {
  const c = resolveModelParamConstraints('kimi-k3')
  assert.equal(c.omitTemperature, true)
  assert.equal(c.omitTopP, true)
  assert.equal(c.forbidDisableThinking, true)
  assert.deepEqual(c.effortVocab, ['low', 'high', 'max'])
})

test('约束表：兼容带路由前缀/后缀的 modelId 写法', () => {
  for (const id of ['moonshot/kimi-k3', 'kimi-k3:free', 'Kimi-K3', 'kimi_k3']) {
    assert.equal(resolveModelParamConstraints(id).omitTemperature, true, id)
  }
  assert.equal(resolveModelParamConstraints('Pro/zai-org/GLM-5.3').forbidDisableThinking, true)
})

test('约束表：未收录的模型一律不干预（零行为变更）', () => {
  for (const id of ['deepseek-v4-pro', 'qwen3.7-max', 'gpt-5.6', 'glm-5.2', '']) {
    const c = resolveModelParamConstraints(id)
    assert.equal(c.omitTemperature, false, id)
    assert.equal(c.omitTopP, false, id)
    assert.equal(c.dropReasoningEffort, false, id)
    assert.equal(c.forbidDisableThinking, false, id)
    assert.equal(c.effortVocab, null, id)
  }
})

test('档位映射：medium 在无 medium 词表中降为 high，合法档位原样保留', () => {
  const vocab = ['low', 'high', 'max'] as const
  assert.equal(mapEffortToVocab('medium', [...vocab]), 'high')
  assert.equal(mapEffortToVocab('high', [...vocab]), 'high')
  assert.equal(mapEffortToVocab('max', [...vocab]), 'max')
  assert.equal(mapEffortToVocab('low', [...vocab]), 'low')
  assert.equal(mapEffortToVocab('medium', null), 'medium')
})

// ---------- 报错一：GLM-5.3 reasoning_effort=medium ----------

test('glm-5.3：medium 必须被改写成 high（原报错 invalid_parameter_error）', async () => {
  const payload = await capturePayload(chatModel('glm-5.3'))
  assert.equal(payload.reasoning_effort, 'high')
})

test('glm-5.3：不接受的参数不新增，temperature 仍按用户配置发送', async () => {
  const payload = await capturePayload(chatModel('glm-5.3'), { temperature: 0.3 })
  assert.equal(payload.temperature, 0.3, 'GLM 未约束 temperature，应保持原行为')
  assert.equal(payload.max_tokens, 4096)
})

test('glm-5.3：关闭思考的参数不应发送（官方已不支持 disabled）', async () => {
  const payload = await capturePayload(chatModel('glm-5.3', { enableThinking: false }))
  assert.equal(payload.enable_thinking, undefined)
  assert.equal(payload.thinking, undefined)
  assert.equal(payload.reasoning_effort, undefined)
})

test('glm-5.2：medium 合法，保持原样发送', async () => {
  const payload = await capturePayload(chatModel('glm-5.2'))
  assert.equal(payload.reasoning_effort, 'medium')
})

// ---------- 报错二：Kimi K3 temperature=0.7 ----------

test('kimi-k3：不发送 temperature/top_p（原报错 Parameter temperature=0.7 is not supported）', async () => {
  const payload = await capturePayload(chatModel('kimi-k3'))
  assert.equal('temperature' in payload, false, 'temperature 必须整个不发')
  assert.equal('top_p' in payload, false, 'top_p 必须整个不发')
  assert.equal(payload.max_tokens, 4096, 'max_tokens 不受约束，仍应发送')
})

test('kimi-k3：reasoning_effort 同时被纠正为合法档位', async () => {
  const payload = await capturePayload(chatModel('kimi-k3'))
  assert.equal(payload.reasoning_effort, 'high')
})

test('kimi-k2.7-code：不支持 reasoning_effort，完全不发该字段', async () => {
  const payload = await capturePayload(chatModel('kimi-k2.7-code'))
  assert.equal('reasoning_effort' in payload, false)
  assert.equal('temperature' in payload, false)
})

// ---------- 未命中模型：零行为变更 ----------

test('普通模型（deepseek）：参数与改动前完全一致', async () => {
  const payload = await capturePayload(chatModel('deepseek-v4-pro'), { temperature: 0.5, topP: 0.9 })
  assert.equal(payload.temperature, 0.5)
  assert.equal(payload.top_p, 0.9)
  assert.equal(payload.reasoning_effort, 'medium')
  assert.equal(payload.max_tokens, 4096)
})

test('普通模型关闭思考：仍按原逻辑发送 enable_thinking=false', async () => {
  const payload = await capturePayload(chatModel('deepseek-v4-pro', { enableThinking: false }))
  assert.equal(payload.enable_thinking, false)
})

// ---------- 其他协议同样受约束 ----------

test('anthropic 协议 + glm-5.3：effort 纠正，且关闭思考时不发 thinking.disabled', async () => {
  const on = await capturePayload({ apiProtocol: 'anthropic', modelId: 'glm-5.3', enableThinking: true, thinkingEffort: 'medium' } as AnyModel)
  assert.equal(on.reasoning.effort, 'high')

  const off = await capturePayload({ apiProtocol: 'anthropic', modelId: 'glm-5.3', enableThinking: false } as AnyModel)
  assert.equal('thinking' in off, false)
})

test('responses 协议 + kimi-k3：reasoning.effort 落在合法词表内', async () => {
  const payload = await capturePayload({ apiProtocol: 'openai-response', modelId: 'kimi-k3', enableThinking: true, thinkingEffort: 'medium' } as AnyModel)
  assert.equal(payload.reasoning.effort, 'high')
})

test('responses 协议 + kimi-k2.6：不支持 effort 时不发 reasoning 字段', async () => {
  const payload = await capturePayload({ apiProtocol: 'openai-response', modelId: 'kimi-k2.6', enableThinking: true } as AnyModel)
  assert.equal('reasoning' in payload, false)
})

// ---------- URL 拼接未被本次改动破坏 ----------

test('Base URL 版本感知拼接仍正常', async () => {
  const withVersion = await capturePayload(chatModel('kimi-k3'), { baseUrl: 'https://api.moonshot.cn/v1' })
  assert.ok(withVersion.model === 'kimi-k3')

  const code = resolveExecutableModelJsCode(chatModel('kimi-k3'))
  assert.ok(code.includes('/chat/completions'), '模板应包含端点路径')
})
