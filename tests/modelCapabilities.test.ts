/**
 * 模型能力标签解析测试（无网络、无 Tauri 依赖）
 *
 * 回归背景：拉取原先用 OpenAI 兼容端点，该端点不返回能力信息，只能按命名猜。
 * 实测百炼 183 个可调用模型，猜名会判错 12 个：
 *   - qwen-image-2.0 / wan2.7-image / z-image-turbo 被判成「视觉」，
 *     实际 capabilities=["IG"] 是文生图，根本不能识图
 *   - kimi-k3 / deepseek-v4.1-flash / qwen3.8-max 被判成「文本」，
 *     实际含 VU（视觉理解），恰恰是用户要拿来识图的模型
 * 现改为读取 DashScope 原生端点 /api/v1/models 的 capabilities 字段。
 *
 * 运行：node tests/modelCapabilities.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseNativeModelsResponse,
  normalizeModelKey,
  isVisionCapable,
  isChatCapable,
  tabsForCapabilities,
  categoryFromCapabilities,
  buildNativeModelsPageUrl
} from '../src/utils/modelCapabilities.ts'

// 线上实测取值（2026-11-05，百炼 373 个模型）
const REAL: Record<string, string[]> = {
  'qwen3-vl-plus': ['VU', 'Reasoning'],
  'qwen3.5-ocr': ['VU'],
  'vanchin/deepseek-ocr': ['VU', 'TG'],
  'kimi-k3': ['TG', 'VU', 'Reasoning'],
  'deepseek-v4.1-flash': ['TG', 'Reasoning', 'VU'],
  'qwen3.8-max': ['Reasoning', 'VU', 'TG'],
  'qwen3.8-flash': ['TG', 'VU', 'Reasoning'],
  'glm-5.3': ['TG', 'Reasoning'],
  'deepseek-v4-pro': ['Reasoning', 'TG'],
  'qwen-image-2.0': ['IG'],
  'wan2.7-image': ['IG'],
  'z-image-turbo': ['IG'],
  'wan2.7-t2v': ['VG'],
  'qwen3.5-omni-flash': ['Multimodal-Omni'],
  'qwen-audio-3.0-asr-flash': ['ASR'],
  'cosyvoice-v3-flash': ['TTS'],
  'text-embedding-v4': ['TR'],
  'qwen3.7-text-rerank': ['TR'],
}

test('识图判定以 VU/Omni 为准，不再靠名字猜', () => {
  // 这些是旧启发式漏掉的（名字不含 vl/vision/数字+v）
  for (const id of ['kimi-k3', 'deepseek-v4.1-flash', 'qwen3.8-max', 'qwen3.8-flash']) {
    assert.equal(isVisionCapable(REAL[id]), true, `${id} 含 VU，应可用于识图`)
  }
  // 纯 VL 模型没有 TG，同样要认出来
  assert.equal(isVisionCapable(REAL['qwen3-vl-plus']), true)
  assert.equal(isVisionCapable(REAL['qwen3.5-ocr']), true)
  assert.equal(isVisionCapable(REAL['qwen3.5-omni-flash']), true)
})

test('文生图 / 视频 / 语音 / 向量模型不得被当成识图（旧启发式的 12 个误判）', () => {
  for (const id of ['qwen-image-2.0', 'wan2.7-image', 'z-image-turbo', 'wan2.7-t2v', 'qwen-audio-3.0-asr-flash', 'cosyvoice-v3-flash', 'text-embedding-v4', 'qwen3.7-text-rerank']) {
    assert.equal(isVisionCapable(REAL[id]), false, `${id} 不能识图`)
  }
})

test('glm-5.3 只有 TG+Reasoning：属于文本页签，不属于识图', () => {
  const tabs = tabsForCapabilities(REAL['glm-5.3'])
  assert.deepEqual(tabs, { text: true, vision: false })
})

test('多能力模型同时属于两个页签（能力是多值，不是互斥二分）', () => {
  const tabs = tabsForCapabilities(REAL['kimi-k3'])
  assert.deepEqual(tabs, { text: true, vision: true })
})

test('对话可用性：TG/VU/Reasoning 任一即可，纯 IG/VG/TTS/TR 不可', () => {
  assert.equal(isChatCapable(REAL['qwen3-vl-plus']), true, '纯 VL 模型也可对话')
  assert.equal(isChatCapable(REAL['glm-5.3']), true)
  assert.equal(isChatCapable(REAL['qwen-image-2.0']), false, '文生图不能当答题模型')
  assert.equal(isChatCapable(REAL['text-embedding-v4']), false)
  assert.equal(isChatCapable([]), false)
  assert.equal(isChatCapable(null), false)
})

test('无标签返回 null，由调用方回退命名启发式', () => {
  assert.equal(tabsForCapabilities(null), null)
  assert.equal(tabsForCapabilities([]), null)
  assert.equal(categoryFromCapabilities(null, 'vision'), null)
})

test('类型预填：识图页签优先给 vision', () => {
  assert.equal(categoryFromCapabilities(REAL['kimi-k3'], 'vision'), 'vision')
  assert.equal(categoryFromCapabilities(REAL['kimi-k3'], 'text'), 'text')
  // 纯 VL 模型没有 TG，文本页签也只能给 vision（否则会被过滤掉）
  assert.equal(categoryFromCapabilities(REAL['qwen3-vl-plus'], 'text'), 'vision')
})

// ---------- 响应解析 ----------

test('解析原生端点响应结构', () => {
  const json = {
    code: null,
    success: true,
    output: {
      total: 373,
      page_no: 1,
      page_size: 100,
      models: [
        { model: 'kimi-k3', capabilities: ['TG', 'VU', 'Reasoning'] },
        { model: 'qwen-image-2.0', capabilities: ['IG'] },
        { model: 'bad-no-caps' },
      ],
    },
  }
  const map = parseNativeModelsResponse(json)
  assert.ok(map)
  assert.equal(map.size, 3)
  assert.deepEqual(map.get('kimi-k3'), ['TG', 'VU', 'Reasoning'])
  assert.deepEqual(map.get('qwen-image-2.0'), ['IG'])
  assert.deepEqual(map.get('bad-no-caps'), [])
})

test('非原生结构返回 null（触发回退，不会当成空列表）', () => {
  assert.equal(parseNativeModelsResponse({ object: 'list', data: [{ id: 'x' }] }), null)
  assert.equal(parseNativeModelsResponse(null), null)
  assert.equal(parseNativeModelsResponse({ output: {} }), null)
  assert.equal(parseNativeModelsResponse({ output: { models: [] } }), null)
  assert.equal(parseNativeModelsResponse('html string'), null)
})

test('capabilities 非数组或含脏值时安全降级', () => {
  const map = parseNativeModelsResponse({
    output: { models: [{ model: 'a', capabilities: 'VU,TG' }, { model: 'b', capabilities: [null, '', 'VU'] }] }
  })
  assert.ok(map)
  assert.deepEqual(map.get('a'), [])
  assert.deepEqual(map.get('b'), ['VU'])
})

// ---------- ID 归一化与端点 ----------

test('cmaas- 前缀归一化：compatible-mode 与原生端点同一模型可对上', () => {
  assert.equal(normalizeModelKey('cmaas-glm-5.3'), 'glm-5.3')
  assert.equal(normalizeModelKey('CMAAS-Qwen3.8-Flash'), 'qwen3.8-flash')
  assert.equal(normalizeModelKey('  kimi-k3  '), 'kimi-k3')
  assert.equal(normalizeModelKey(''), '')
})

test('原生端点地址只取 origin，忽略 compatible-mode 路径后缀', () => {
  const url = buildNativeModelsPageUrl(
    'https://llm-abc.cn-beijing.maas.aliyuncs.com/compatible-mode',
    2
  )
  assert.equal(url, 'https://llm-abc.cn-beijing.maas.aliyuncs.com/api/v1/models?page_no=2&page_size=100')
})

test('百炼主站同样归一到 /api/v1/models', () => {
  assert.equal(
    buildNativeModelsPageUrl('https://dashscope.aliyuncs.com/compatible-mode/v1', 1),
    'https://dashscope.aliyuncs.com/api/v1/models?page_no=1&page_size=100'
  )
})
