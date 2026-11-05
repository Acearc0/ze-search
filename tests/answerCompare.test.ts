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

test('未声明 unordered 时多选顺序仍敏感（默认保守，见下方 unordered 用例）', () => {
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

// ---------- 词表对齐 OCS（judgement.ts 的 CORRECT_WORDS / INCORRECT_WORDS） ----------

test('OCS 同义词一并归一：对的/是的/确定/不正确的 等', () => {
  assert.ok(isSameAnswer('{"answer":"对的"}', '{"answer":"正确"}'))
  assert.ok(isSameAnswer('{"answer":"是的"}', '{"answer":"对"}'))
  assert.ok(isSameAnswer('{"answer":"确定"}', '{"answer":"正确"}'))
  assert.ok(isSameAnswer('{"answer":"不对"}', '{"answer":"错误"}'))
  assert.ok(isSameAnswer('{"answer":"不正确的"}', '{"answer":"错"}'))
  assert.ok(isSameAnswer('{"answer":"不是"}', '{"answer":"否"}'))
})

test('刻意不收 1/0/T/F/X：填空题答案恰好是这些时不得被当成判断词', () => {
  assert.ok(!isSameAnswer('{"answer":"1"}', '{"answer":"正确"}'), '填空答案 1 不应等于「正确」')
  assert.ok(!isSameAnswer('{"answer":"0"}', '{"answer":"错误"}'), '填空答案 0 不应等于「错误」')
  assert.ok(!isSameAnswer('{"answer":"T"}', '{"answer":"正确"}'))
  assert.ok(!isSameAnswer('{"answer":"F"}', '{"answer":"错误"}'))
  assert.ok(!isSameAnswer('{"answer":"X"}', '{"answer":"错误"}'))
})

// ---------- 选项字母前缀：与发给 OCS 的口径保持一致 ----------

const SINGLE_OPTIONS = 'A. 压力角\nB. 传动角\nC. 极力夹角'

test('带选项表时剥离字母前缀：「B. 传动角」与「传动角」判等（此前误判触发仲裁）', () => {
  const opts = { options: SINGLE_OPTIONS }
  assert.ok(isSameAnswer('{"answer":"传动角"}', '{"answer":"B. 传动角"}', opts))
  assert.ok(isSameAnswer('{"answer":"传动角"}', '{"answer":"B、传动角"}', opts), '顿号前缀同样剥离')
  assert.ok(isSameAnswer('{"answer":"传动角"}', '{"answer":"B) 传动角"}', opts))
})

test('前缀剥离不影响不同答案的区分', () => {
  const opts = { options: SINGLE_OPTIONS }
  assert.ok(!isSameAnswer('{"answer":"B. 传动角"}', '{"answer":"A. 压力角"}', opts))
})

test('无选项表时仍剥离空格形式的字母前缀（与输出规范化同规则）', () => {
  assert.ok(isSameAnswer('{"answer":"传动角"}', '{"answer":"B. 传动角"}'))
})

test('字母前缀护栏：纯字母答案不得被当成前缀剥离（留给字母映射）', () => {
  const opts = { options: SINGLE_OPTIONS }
  // 「B」是合法的字母答案形式，不能被剥成空；与「传动角」不应判等
  assert.ok(!isSameAnswer('{"answer":"B"}', '{"answer":"传动角"}', opts))
})

// ---------- ### 片段顺序：多选无关，填空有语义 ----------

test('多选题：### 片段顺序无关，判等（OCS 逐片段独立匹配选项）', () => {
  const opts = { unordered: true }
  assert.ok(isSameAnswer('{"answer":"键盘###鼠标"}', '{"answer":"鼠标###键盘"}', opts))
  assert.ok(isSameAnswer('{"answer":"A. 键盘###C. 鼠标"}', '{"answer":"鼠标###键盘"}', { ...opts, options: 'A. 键盘\nB. 显示器\nC. 鼠标' }))
})

test('填空题护栏：片段按空位索引对应，顺序不同绝不能判等', () => {
  // 北京###上海 与 上海###北京 是不同答案（第一空/第二空）
  assert.ok(!isSameAnswer('{"answer":"北京###上海"}', '{"answer":"上海###北京"}'))
  assert.ok(!isSameAnswer('{"answer":"北京###上海"}', '{"answer":"上海###北京"}', { unordered: false }))
})

test('题型未知时默认顺序敏感（保守：宁可多调一次模型，不可误判一致）', () => {
  assert.ok(!isSameAnswer('{"answer":"键盘###鼠标"}', '{"answer":"鼠标###键盘"}'))
})

test('多选排序不影响不同答案集合的区分', () => {
  const opts = { unordered: true }
  assert.ok(!isSameAnswer('{"answer":"键盘###鼠标"}', '{"answer":"键盘###显示器"}', opts))
  assert.ok(!isSameAnswer('{"answer":"键盘###鼠标"}', '{"answer":"键盘"}', opts), '少选一个不得判等')
})

// ---------- 外层包裹引号：模型对「答案要不要带引号」习惯不一 ----------

test('回归（2026-11-05 截图）：SQL 题三模型中 deepseek 给答案套引号，不应触发仲裁', () => {
  const qwen = '{"answer":"王_"}'
  const deepseek = '{"answer":"\\"王_\\""}'
  const glm = '{"answer":"王_"}'
  // 第一波 qwen vs deepseek 必须判等，否则就会白调 glm-5.3
  assert.ok(isSameAnswer(qwen, deepseek), '带引号与不带引号应判等')
  assert.ok(isSameAnswer(qwen, glm))
  assert.ok(isSameAnswer(deepseek, glm))
})

test('引号形态全覆盖：ASCII / 中文弯引号 / 单引号 / 反引号 / 书名号', () => {
  const plain = '{"answer":"王_"}'
  for (const wrapped of [
    '{"answer":"\\"王_\\""}',
    '{"answer":"“王_”"}',
    '{"answer":"‘王_’"}',
    '{"answer":"\'王_\'"}',
    '{"answer":"`王_`"}',
    '{"answer":"「王_」"}',
    '{"answer":"『王_』"}'
  ]) {
    assert.ok(isSameAnswer(plain, wrapped), `应判等：${wrapped}`)
  }
})

test('多层包裹也能剥离，但不会剥穿成空', () => {
  assert.ok(isSameAnswer('{"answer":"王_"}', '{"answer":"“\\"王_\\"”"}'), '两层包裹')
  // 答案本身就是引号字符时不能被剥没：比较键非空
  assert.ok(buildAnswerCompareKey('{"answer":"\\""}').length > 0, '单个引号答案不应变空')
})

test('护栏：引号只剥首尾成对的，不动答案内部的符号', () => {
  // 这道题考查的正是通配符差异，绝不能因剥引号而塌缩
  assert.ok(!isSameAnswer('{"answer":"王_"}', '{"answer":"王__"}'), '王_ 与 王__ 是不同选项')
  assert.ok(!isSameAnswer('{"answer":"王%"}', '{"answer":"%王%"}'), '王% 与 %王% 是不同选项')
  // 内部引号不剥
  assert.ok(!isSameAnswer('{"answer":"他说"对"啊"}', '{"answer":"他说对啊"}'), '中间引号不属于包裹')
})

test('多选片段各自带引号也能与干净版本判等', () => {
  const opts = { unordered: true }
  assert.ok(isSameAnswer('{"answer":"键盘###鼠标"}', '{"answer":"\\"键盘\\"###\\"鼠标\\""}', opts))
  assert.ok(isSameAnswer('{"answer":"键盘###鼠标"}', '{"answer":"“键盘###鼠标”"}', opts), '整体包裹一种、逐段包裹另一种')
})

test('字母前缀与引号同时出现时都能剥（B. "传动角"）', () => {
  const opts = { options: 'A. 压力角\nB. 传动角\nC. 极力夹角' }
  assert.ok(isSameAnswer('{"answer":"传动角"}', '{"answer":"B. \\"传动角\\""}', opts))
})
