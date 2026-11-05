/**
 * 联网搜索来源污染答案的回归测试（无网络、无 Tauri 依赖）
 *
 * 背景：搜索引导语曾要求模型「在 answer 正文末尾追加来源」，导致链接被写进答案，
 * 进而污染本地题库与发给 OCS 的判分文本（实测题库 ID 135）。
 *
 * 运行：node tests/sourceCitation.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  stripSourceCitation,
  buildAnswerCompareKey,
  extractAnswerFromMixedContent
} from '../src/utils/answerExtract.ts'
import { normalizeAnswerJsonContent, normalizeAnswerAgainstOptions } from '../src/utils/answerNormalize.ts'

// ---------- 实测污染样本 ----------

test('剥离：题库 ID 135 的实测污染文本', () => {
  assert.equal(
    stripSourceCitation('字符编码（来源: 1. https://blog.csdn.net/W_Fe5/article/details/140886173）'),
    '字符编码'
  )
})

test('提取：answer 字段本身保留原样，由规范化层剥离', () => {
  assert.equal(
    extractAnswerFromMixedContent('{"answer": "字符编码（来源: 1. https://blog.csdn.net/x/123）"}'),
    '字符编码（来源: 1. https://blog.csdn.net/x/123）'
  )
})

test('剥离：发给后端的 JSON 中 answer 已干净', () => {
  assert.equal(
    normalizeAnswerJsonContent('{"answer": "字符编码（来源: 1. https://blog.csdn.net/x/123）"}', ''),
    '{"answer":"字符编码"}'
  )
})

test('新格式：SOURCES 独立行不污染答案（提取层与比较键都干净）', () => {
  const content = '{"answer":"字符编码"}\nSOURCES: 1. https://a.example/1 2. https://b.example/2'
  // 提取层只取 JSON 内的 answer，SOURCES 行留在 content 里供展示/溯源
  assert.equal(extractAnswerFromMixedContent(content), '字符编码')
  assert.equal(buildAnswerCompareKey(content), '字符编码')
  // normalizeAnswerJsonContent 对「JSON + 尾随文本」保持既有透传行为，不吞掉 SOURCES
  assert.equal(normalizeAnswerJsonContent(content, ''), content)
})

// ---------- 护栏：不能误伤正常答案 ----------

test('护栏：正文中间的「来源」不误伤', () => {
  assert.equal(stripSourceCitation('资金来源:企业自有资金'), '资金来源:企业自有资金')
  assert.equal(stripSourceCitation('数据来源多样（见第三章），本题不考'), '数据来源多样（见第三章），本题不考')
})

test('护栏：无 URL 的来源标签不剥离', () => {
  assert.equal(stripSourceCitation('字符编码（来源: 教材）'), '字符编码（来源: 教材）')
})

test('护栏：正常答案原样返回', () => {
  assert.equal(stripSourceCitation('VARCHAR'), 'VARCHAR')
  assert.equal(stripSourceCitation('正确'), '正确')
  assert.equal(stripSourceCitation(''), '')
})

// ---------- 变体覆盖 ----------

test('剥离：多来源、全半角混排、无括号形式', () => {
  assert.equal(stripSourceCitation('VARCHAR（来源: 1. https://a.cn/x 2. https://b.cn/y）'), 'VARCHAR')
  assert.equal(stripSourceCitation('VARCHAR(来源：https://a.cn/x)'), 'VARCHAR')
  assert.equal(stripSourceCitation('VARCHAR 来源: https://a.cn/x'), 'VARCHAR')
})

test('剥离：多空 ### 场景逐段干净', () => {
  assert.equal(
    normalizeAnswerJsonContent('{"answer":"北京（来源: https://a.cn/1）###上海"}', ''),
    '{"answer":"北京###上海"}'
  )
})

// ---------- 比较键：带来源与不带来源必须判等 ----------

test('比较键：同一答案带来源/不带来源视为一致', () => {
  assert.equal(buildAnswerCompareKey('{"answer":"VARCHAR"}'), 'varchar')
  assert.equal(buildAnswerCompareKey('{"answer": "VARCHAR（来源: 1. https://blog.csdn.net/x/1）"}'), 'varchar')
})

test('比较键：剥离后不同答案仍不等', () => {
  const a = '{"answer":"字符编码（来源: https://a.cn/1）"}'
  const b = '{"answer":"存储引擎（来源: https://a.cn/1）"}'
  assert.notEqual(buildAnswerCompareKey(a), buildAnswerCompareKey(b))
})

// ---------- 字母映射不被破坏 ----------

test('字母映射：带来源时仍能映射为选项正文', () => {
  const options = 'A. 主键\nB. 字符编码\nC. 索引'
  assert.equal(normalizeAnswerAgainstOptions('B（来源: https://a.cn/1）', options), '字符编码')
})
