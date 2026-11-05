/**
 * 模型命名分类启发式测试（无网络、无 Tauri 依赖）
 *
 * 回归背景：拉取弹窗原先把 /models 返回的全部模型一律预填成「文本」，
 * 在视觉页签「全选新增」后纯文本模型被混进识图池；而 glm-4.6v 这类
 * 「数字+v」命名的真视觉模型又识别不出。现按页签过滤，故锁死判断逻辑。
 *
 * 运行：node tests/modelCategory.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  guessModelCategory,
  tabTargetCategory,
  matchesTab
} from '../src/utils/modelCategory.ts'

// 截图里百炼 /models 返回的真实 ID
const REAL_TEXT_IDS = [
  'deepseek-v4-flash-0731',
  'deepseek-v4-pro',
  'deepseek-v4-pro-0813',
  'deepseek-v4.1-flash',
  'deepseek-v4.1-flash-1017',
  'fun-asr-flash-2026-06-15',
  'glm-5',
  'glm-5.2',
  'qwen3.8-max',
  'kimi-k3',
]

const REAL_VISION_IDS = [
  'glm-4.6v',
  'glm-5v-turbo',
  'qwen3.7-vl-plus',
  'qwen-vl-max',
  'gpt-4o-image',
  'omni-v2',
  'kimi-k2.5-vision',
]

test('纯文本模型不得被判成视觉（旧版全选污染识图池的根因）', () => {
  for (const id of REAL_TEXT_IDS) {
    assert.equal(guessModelCategory(id), 'text', id)
    assert.equal(matchesTab(id, 'vision'), false, `${id} 不应出现在识图页签`)
  }
})

test('带视觉标记的模型必须识别为视觉', () => {
  for (const id of REAL_VISION_IDS) {
    assert.equal(guessModelCategory(id), 'vision', id)
    assert.equal(matchesTab(id, 'text'), false, `${id} 不应出现在文本页签`)
  }
})

test('「-v4」这类版本号不得被误判成视觉（关键护栏）', () => {
  for (const id of ['deepseek-v4-pro', 'deepseek-v4.1-flash', 'glm-5-v4', 'x-v4']) {
    assert.equal(guessModelCategory(id), 'text', id)
  }
})

test('页签目标分类：文本与总结都对应 text，识图对应 vision', () => {
  assert.equal(tabTargetCategory('text'), 'text')
  assert.equal(tabTargetCategory('summary'), 'text')
  assert.equal(tabTargetCategory('vision'), 'vision')
})

test('识图页签只放行视觉模型', () => {
  const ids = [...REAL_TEXT_IDS, ...REAL_VISION_IDS]
  const visionTab = ids.filter(id => matchesTab(id, 'vision'))
  assert.deepEqual(visionTab, REAL_VISION_IDS)
})

test('文本页签只放行文本模型', () => {
  const ids = [...REAL_TEXT_IDS, ...REAL_VISION_IDS]
  const textTab = ids.filter(id => matchesTab(id, 'text'))
  assert.deepEqual(textTab, REAL_TEXT_IDS)
})

test('空值与异常输入回退为文本，不抛错', () => {
  assert.equal(guessModelCategory(''), 'text')
  assert.equal(guessModelCategory(undefined as unknown as string), 'text')
  assert.equal(guessModelCategory(null as unknown as string), 'text')
})
