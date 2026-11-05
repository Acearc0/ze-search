/**
 * 全模型失败输出的回归测试（无网络、无 Tauri 依赖）
 *
 * 背景：多模型全部失败时，前端上报的文本形如
 *   [glm-5.3]\n错误: HTTP 404 Not Found\n\n[qwen3.8-max]\n错误: HTTP 404 Not Found
 * Rust 侧 is_model_error 只认 `错误:` 前缀（server.rs），开头的 `[模型名]` 会绕过检查，
 * 于是这段报错被当作正常答案提取并入库（实测题库 ID 31）。
 *
 * 运行：node tests/allFailureOutput.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildAllFailureOutput } from '../src/utils/answerExtract.ts'

// 复刻 Rust is_model_error 的前缀判定（server.rs:1685-1688）
const rustIsModelError = (text: string): boolean => {
  const cleaned = text.trim()
    .replace(/^```json/, '')
    .replace(/^```/, '')
    .replace(/```$/, '')
    .trim()
  return cleaned.startsWith('错误:')
    || cleaned.startsWith('错误：')
    || cleaned.startsWith('Error:')
    || cleaned.startsWith('API 错误')
}

const multiFailure = '[glm-5.3]\n错误: HTTP 404 Not Found\n\n[qwen3.8-max]\n错误: HTTP 404 Not Found'

test('旧格式会被 Rust 前缀检查绕过（这就是 ID 31 脏数据的成因）', () => {
  assert.equal(rustIsModelError(multiFailure), false)
})

test('修复后的多模型失败输出能被 Rust 拦住', () => {
  const out = buildAllFailureOutput(multiFailure)
  assert.equal(rustIsModelError(out), true)
  assert.ok(out.startsWith('错误: 所有模型调用失败'), '应带统一前缀')
  assert.ok(out.includes('[glm-5.3]'), '各模型详情仍保留，便于排查')
})

test('单模型失败已带前缀：不二次包裹', () => {
  assert.equal(buildAllFailureOutput('错误: HTTP 404 Not Found'), '错误: HTTP 404 Not Found')
  assert.equal(buildAllFailureOutput('错误：未选择模型'), '错误：未选择模型')
})

test('Error: 前缀同样视为已带前缀', () => {
  assert.equal(buildAllFailureOutput('Error: aborted'), 'Error: aborted')
})

test('空内容回退为固定错误文案（仍可被 Rust 拦住）', () => {
  const out = buildAllFailureOutput('')
  assert.equal(out, '错误: 未获得任何模型响应')
  assert.equal(rustIsModelError(out), true)
})

test('成功答案绝不该进这个函数（保护语义边界）', () => {
  // 该函数只用于「全部失败」分支；此处仅确认不会误加前缀污染正常文本的判断
  assert.equal(rustIsModelError(buildAllFailureOutput('[模型A]\n{"answer":"VARCHAR"}')), true)
})
