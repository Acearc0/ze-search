/**
 * 答案提取与比较键测试（无网络、无 Tauri 依赖）
 *
 * 回归目标：多模型答案其实一致时，懒投票必须短路、多数票必须合票。
 * 用例文本取自线上真实输出（2026-11-04 截图：同一题三个模型均答 VARCHAR）。
 *
 * 运行：node tests/answerCompare.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  extractAnswerFromMixedContent,
  buildAnswerCompareKey,
  isSameAnswer
} from '../src/utils/answerExtract.ts'

// ---------- 提取 ----------

test('提取：纯 JSON 与带空格风格都能取到 answer', () => {
  assert.equal(extractAnswerFromMixedContent('{"answer":"VARCHAR"}'), 'VARCHAR')
  assert.equal(extractAnswerFromMixedContent('{"answer": "VARCHAR"}'), 'VARCHAR')
  assert.equal(extractAnswerFromMixedContent('{ "answer" : "VARCHAR" }'), 'VARCHAR')
})

test('提取：JSON 前带解释段落（模型违反指令）仍能取到末尾答案', () => {
  const text = '地址长度不固定，属于文本数据，应使用 VARCHAR。\nBINARY/BLOB 用于二进制数据，CHAR 为定长。\n{"answer": "VARCHAR"}'
  assert.equal(extractAnswerFromMixedContent(text), 'VARCHAR')
})

test('提取：markdown 代码块包裹', () => {
  assert.equal(extractAnswerFromMixedContent('```json\n{"answer":"正确"}\n```'), '正确')
  assert.equal(extractAnswerFromMixedContent('```\n{"answer":"正确"}\n```'), '正确')
})

test('提取：兼容 anwser 拼写错误', () => {
  assert.equal(extractAnswerFromMixedContent('{"anwser":"传动角"}'), '传动角')
})

test('提取：answer 内含 ### 多选分隔符时原样保留', () => {
  assert.equal(extractAnswerFromMixedContent('{"answer":"键盘###鼠标"}'), '键盘###鼠标')
})

test('提取：无 answer 字段时返回空串（由调用方决定回退）', () => {
  assert.equal(extractAnswerFromMixedContent('就是 VARCHAR 吧'), '')
  assert.equal(extractAnswerFromMixedContent(''), '')
  assert.equal(extractAnswerFromMixedContent('错误: HTTP 401 Unauthorized'), '')
})

// ---------- 比较键：线上真实三模型输出必须判为一致 ----------

const glmOutput = '地址长度不固定，属于文本数据，应使用 VARCHAR。\nBINARY/BLOB 用于二进制数据，CHAR 为定长，不适合长度不定的地址。\n{"answer": "VARCHAR"}'
const qwenOutput = '{"answer":"VARCHAR"}'
const deepseekOutput = '{"answer": "VARCHAR"}'

test('回归：glm-5.3（带解释段落）与 qwen3.8-flash（纯 JSON）判为一致', () => {
  assert.ok(isSameAnswer(glmOutput, qwenOutput), '懒投票应据此跳过第三个模型')
})

test('回归：qwen 与 deepseek 仅 JSON 冒号后空格不同，必须判为一致', () => {
  assert.ok(isSameAnswer(qwenOutput, deepseekOutput))
})

test('回归：三个模型两两一致，多数票应合为一票', () => {
  const keys = [glmOutput, qwenOutput, deepseekOutput].map(buildAnswerCompareKey)
  assert.equal(new Set(keys).size, 1, `期望同一键，实际: ${JSON.stringify(keys)}`)
  assert.ok(keys.every(k => !!k), '比较键不得为空')
})

// ---------- 比较键：不同答案绝不能判为一致 ----------

test('不同答案仍判为不一致（VARCHAR vs CHAR）', () => {
  assert.ok(!isSameAnswer('{"answer":"VARCHAR"}', '{"answer":"CHAR"}'))
})

test('判断题正反结论不得混淆', () => {
  assert.ok(!isSameAnswer('{"answer":"正确"}', '{"answer":"错误"}'))
})

test('多选题顺序不同视为不同答案', () => {
  assert.ok(!isSameAnswer('{"answer":"键盘###鼠标"}', '{"answer":"鼠标###键盘"}'))
})

test('选项字母与选项正文不视为一致（该场景由 answerNormalize 处理，此处只保证不误判）', () => {
  assert.ok(!isSameAnswer('{"answer":"B"}', '{"answer":"传动角"}'))
})

test('空内容与报错文本不得判为一致', () => {
  assert.ok(!isSameAnswer('', '{"answer":"VARCHAR"}'))
  assert.ok(!isSameAnswer('错误: HTTP 429', '错误: HTTP 429'), '相同报错也不应被当成答案一致')
})

// ---------- 归一化可激进：空白/全半角/大小写差异应视为同一答案 ----------

test('空白与全半角标点差异视为一致', () => {
  assert.ok(isSameAnswer('{"answer":"变量长度 字符类型"}', '{"answer":"变量长度字符类型"}'))
  assert.ok(isSameAnswer('{"answer":"对，是"}', '{"answer":"对,是"}'))
})

test('answer 与整段正文两条路径都能比对（无 JSON 时回退整段）', () => {
  assert.ok(isSameAnswer('就是 VARCHAR', '就是 VARCHAR '))
  assert.equal(buildAnswerCompareKey('就是 VARCHAR '), buildAnswerCompareKey('就是 varchar'))
})

// ---------- 判断题同义词（题库选项是「对/错」，旧指令要求「正确/错误」） ----------

test('回归：两个判断题模型分别输出「对」与「正确」应判等，不触发第三模型', () => {
  const a = '{"answer": "对"}'
  const b = '{"answer":"正确"}'
  assert.ok(isSameAnswer(a, b))
})

test('判断题：「错」与「错误」判等；但真/假两方绝不混淆', () => {
  assert.ok(isSameAnswer('{"answer":"错"}', '{"answer": "错误"}'))
  assert.ok(!isSameAnswer('{"answer":"对"}', '{"answer":"错"}'))
  assert.ok(!isSameAnswer('{"answer":"正确"}', '{"answer":"错误"}'))
  assert.ok(!isSameAnswer('{"answer":"对"}', '{"answer":"错误"}'))
})

test('判断题：全半角 / 大小写 / 空白差异一并归一', () => {
  assert.ok(isSameAnswer('{"answer":" 对 "}', '{"answer":"正确"}'))
  assert.ok(isSameAnswer('{"answer":"TRUE"}', '{"answer":"对"}'))
  assert.ok(isSameAnswer('{"answer":"√"}', '{"answer":"正确"}'))
  assert.ok(isSameAnswer('{"answer":"×"}', '{"answer":"错误"}'))
})

test('护栏：普通答案里含「对/错/正确/错误」字样不被误归一', () => {
  // 整串相等才归一，包含匹配会误伤这些
  assert.ok(!isSameAnswer('{"answer":"对象存储"}', '{"answer":"正确"}'))
  assert.ok(!isSameAnswer('{"answer":"错误码"}', '{"answer":"错"}'))
  assert.ok(!isSameAnswer('{"answer":"对，是"}', '{"answer":"正确"}'))
  assert.ok(!isSameAnswer('{"answer":"Y"}', '{"answer":"正确"}'), '单字母 Y 不得被当成「正确」')
})
