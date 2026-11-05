/**
 * 构建标识（版本 + commit）展示逻辑测试。
 *
 * 背景：tauri.conf.json 的 version 长期不变，装了包、下了 Actions 产物都分不清
 * 是哪次提交构建的。构建期由 vite define 注入 commit 与构建时间，这里验证展示层
 * 在各种注入组合下的输出（含注入缺失、占位值等异常路径）。
 *
 * 运行：node tests/buildInfo.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatDisplayVersion } from '../src/utils/buildInfo.ts'

test('完整注入：版本号 + commit + 构建时间', () => {
  assert.equal(
    formatDisplayVersion('2.2.7', 'd8c9ced', '2026-11-05 15:08'),
    '2.2.7 (d8c9ced · 2026-11-05 15:08)'
  )
})

test('无构建时间：只显示 commit', () => {
  assert.equal(formatDisplayVersion('2.2.7', 'd8c9ced', ''), '2.2.7 (d8c9ced)')
})

test('无 commit（非 git 环境）：退回纯版本号', () => {
  assert.equal(formatDisplayVersion('2.2.7', '', '2026-11-05 15:08'), '2.2.7')
})

test('占位值 unknown 视为无 commit，不把 unknown 显示给用户', () => {
  assert.equal(formatDisplayVersion('2.2.7', 'unknown', ''), '2.2.7')
  assert.equal(formatDisplayVersion('2.2.7', 'UNKNOWN', '2026-11-05 15:08'), '2.2.7')
  assert.equal(formatDisplayVersion('2.2.7', 'null', ''), '2.2.7')
  assert.equal(formatDisplayVersion('2.2.7', 'undefined', ''), '2.2.7')
})

test('dirty 后缀保留：本地包能看出与提交不一致', () => {
  assert.equal(formatDisplayVersion('2.2.7', 'd8c9ced-dirty', ''), '2.2.7 (d8c9ced-dirty)')
})

test('前后空白被清理', () => {
  assert.equal(formatDisplayVersion('  2.2.7  ', '  d8c9ced  ', '  2026-11-05 15:08  '), '2.2.7 (d8c9ced · 2026-11-05 15:08)')
})

test('运行时版本优先于构建期读取值', () => {
  // 测试环境没有 define 注入，APP_VERSION 为空串，此处应完全采用传入值
  assert.equal(formatDisplayVersion('2.2.8', 'abc1234', ''), '2.2.8 (abc1234)')
})

test('全空：返回空串，由调用方决定兜底显示', () => {
  assert.equal(formatDisplayVersion('', '', ''), '')
})

test('只有 commit 没有任何版本号：返回空串而非畸形括号', () => {
  assert.equal(formatDisplayVersion('', 'd8c9ced', '2026-11-05 15:08'), '')
})
