/**
 * 答题 prompt 契约测试（判断题答案必须跟随选项原文）
 *
 * 回归背景（实测题库 46 道判断题）：选项一律是 `对` / `错`，
 * 但旧 system 规则写死「answer 只能是「正确」或「错误」」，导致：
 *   1. 两个模型分别输出 `对` 与 `正确` 时字面不等，懒投票误判不一致、白调第三模型；
 *   2. 43/46 条判断题答案存成不在选项原文里的文本，OCS 判分风险。
 * 现规则改为「逐字使用题目中的原文」，本测试锁定该契约不被改回去。
 *
 * 为什么用 esbuild 打桩而不是直接 import：
 * answerFewShot.ts 依赖 services/settings（Vue reactive + localStorage + 无扩展名导入），
 * node 直跑无法解析；而 prompt 文本正是本次修复的内容，必须真正被验证到，
 * 所以在此 stub 掉 settings 后加载**真实模块**，而非只读源码文本。
 *
 * 运行：node tests/answerPromptContract.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmpDir = path.join(os.tmpdir(), 'zerror-answer-prompt-contract')
fs.mkdirSync(tmpDir, { recursive: true })
const bundlePath = path.join(tmpDir, 'answerFewShot.bundle.mjs')

// 重新打包，避免读到上次运行的陈旧产物
const result = await build({
  entryPoints: [path.resolve('src/utils/answerFewShot.ts')],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  absWorkingDir: process.cwd(),
  plugins: [
    {
      name: 'stub-settings',
      setup(b) {
        b.onResolve({ filter: /services\/settings$/ }, () => ({ path: 'settings', namespace: 'stub-settings' }))
        b.onLoad({ filter: /.*/, namespace: 'stub-settings' }, () => ({
          // 联网搜索默认关闭：与既有行为一致（不注入搜索引导）
          contents: 'export const useSettings = () => ({ settings: { webSearch: { enabled: false } } })',
          loader: 'js'
        }))
      }
    }
  ]
})
fs.writeFileSync(bundlePath, result.outputFiles[0].text)

const { buildAnswerChatMessages, detectAnswerFewShotKind } =
  await import('file:///' + bundlePath.replace(/\\/g, '/'))

/** 取 system 消息内容（无 system 时为空串） */
const systemOf = (query: string): string => {
  const msgs = buildAnswerChatMessages(query)
  return msgs[0]?.role === 'system' ? msgs[0].content : ''
}

const judgementQuery = '【题目类型：判断题】\n【题目】地球绕太阳公转一周约为 365 天。\n【选项】\n对\n错'

test('system 规则要求逐字使用题目原文，不再硬性规定「正确/错误」', () => {
  const s = systemOf(judgementQuery)
  assert.ok(s, '判断题应带 system 规则')
  assert.ok(s.includes('逐字使用题目中的原文'), `规则应要求跟随原文，实际：${s}`)
  assert.ok(!/判断题\s*answer\s*只能是/.test(s), '不得残留旧的「只能是正确或错误」规则')
})

test('判断题示例带【选项】，且答案用选项原文「对」「错」', () => {
  const msgs = buildAnswerChatMessages(judgementQuery)
  const assistants = msgs.filter(m => m.role === 'assistant').map(m => m.content)
  assert.ok(assistants.length > 0, '应注入 few-shot 示例')
  assert.ok(
    assistants.some(a => a.includes('对') || a.includes('错')),
    `示例答案应为选项原文，实际：${JSON.stringify(assistants)}`
  )
  assert.ok(
    !assistants.some(a => a.includes('正确') || a.includes('错误')),
    `示例不得再教「正确/错误」，实际：${JSON.stringify(assistants)}`
  )

  const users = msgs.filter(m => m.role === 'user').map(m => m.content)
  assert.ok(
    users.some(u => u.includes('【选项】') && /\n对\n错/.test(u)),
    '示例题目应带 对/错 选项，否则模型无从跟随'
  )
})

test('general（题型未知）不混入判断题示例，避免无题型 query 被带偏', () => {
  const msgs = buildAnswerChatMessages('随便问一个问题')
  const all = msgs.map(m => m.content).join('\n')
  assert.ok(!/【选项】\n对\n错/.test(all), 'general 示例不应包含判断题的对/错选项')
})

test('题型识别覆盖五种类型', () => {
  const cases: Array<[string, string]> = [
    ['【题目类型：判断题】', 'judgement'],
    ['【题目类型：单选题】', 'single'],
    ['【题目类型：多选题】', 'multiple'],
    ['【题目类型：填空题】', 'completion'],
    ['随便问', 'general']
  ]
  for (const [query, expected] of cases) {
    assert.equal(detectAnswerFewShotKind(query), expected, query)
  }
})

test('联网搜索关闭时不注入工具引导（保持既有行为）', () => {
  const s = systemOf('【题目类型：单选题】\n【题目】1+1=?\n【选项】\nA. 2\nB. 3')
  assert.ok(!s.includes('web_search'), '搜索关闭时 system 不应出现 web_search')
})
