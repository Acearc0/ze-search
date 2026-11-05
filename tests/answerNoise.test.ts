/**
 * 答案噪声剥离的「两条链路口径一致」测试
 *
 * 背景：判等路径（buildAnswerCompareKey，决定要不要多调一个仲裁模型）与
 * 输出路径（normalizeAnswerAgainstOptions，决定发给 OCS 判分的文本）
 * 必须对同一答案得到同一清理结果，否则会出现两类完全不同的故障：
 *   - 输出剥了、判等没剥 → 同一答案判为不一致，白调仲裁模型；
 *   - 判等剥了、输出没剥 → 带引号/前缀的文本进入判分，OCS 整串匹配失败。
 * 本测试把「一致性」本身锁住，而不只锁单侧行为。
 *
 * 运行：node tests/answerNoise.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildAnswerCompareKey } from '../src/utils/answerExtract.ts'
import { normalizeAnswerAgainstOptions } from '../src/utils/answerNormalize.ts'
import { stripWrappingQuotes, stripSourceCitation } from '../src/utils/answerNoise.ts'

const OPTS = 'A. 压力角\nB. 传动角\nC. 极力夹角'

/** 判等用的键（把答案包成模型真实输出形态） */
const keyOf = (answer: string, options: string | null = OPTS): string =>
  buildAnswerCompareKey(JSON.stringify({ answer }), { options })

/** 发给 OCS 的文本 */
const outputOf = (answer: string, options: string | null = OPTS): string =>
  normalizeAnswerAgainstOptions(answer, options)

// ---------- 口径一致 ----------

test('噪声形态：输出与判等必须归一到同一结果', () => {
  const forms = [
    'B. 传动角',
    'B. "传动角"',
    '"B. 传动角"',
    'B、"传动角"',
    '传动角',
  ]
  for (const f of forms) {
    // 判等键会再做形状归一，故与输出比较时同样去空白后对齐
    assert.equal(
      keyOf(f).replace(/\s+/g, ''),
      outputOf(f).replace(/\s+/g, ''),
      `形态 ${JSON.stringify(f)} 两条链路结果不同`
    )
  }
})

test('来源引用：输出与判等都得剥掉', () => {
  const withSrc = '字符编码（来源: 1. https://blog.csdn.net/x）'
  assert.equal(outputOf(withSrc, ''), '字符编码')
  assert.equal(keyOf(withSrc, ''), '字符编码')
})

test('回归：多片段来源不得被整段剥离吞掉', () => {
  // stripSourceCitation 尾部锚定，若对整段调用会把 `###上海` 一起删掉
  const src = '北京（来源: https://a.cn/1）###上海'
  assert.equal(outputOf(src, ''), '北京###上海')
  assert.equal(keyOf(src, ''), '北京###上海')
})

// ---------- 引号剥离单元 ----------

test('stripWrappingQuotes 剥成对包裹、保留内部引号', () => {
  assert.equal(stripWrappingQuotes('"王_"'), '王_')
  assert.equal(stripWrappingQuotes('“王_”'), '王_')
  assert.equal(stripWrappingQuotes('`x`'), 'x')
  assert.equal(stripWrappingQuotes('"\'x\'"'), 'x', '两层包裹')
  assert.equal(stripWrappingQuotes('王_'), '王_', '无包裹不动')
  assert.equal(stripWrappingQuotes('他说"对"啊'), '他说"对"啊', '内部引号不剥')
  // 内层为空时不剥（护栏）：答案本身就是 `""` 时不能剥成空串，否则比较键为空会判不一致
  assert.equal(stripWrappingQuotes('""'), '""', '空包裹保留原样')
})

test('stripSourceCitation 护栏：无 URL 不剥', () => {
  assert.equal(stripSourceCitation('资金来源:企业自有资金'), '资金来源:企业自有资金')
  assert.equal(stripSourceCitation('数据来源多样（见第三章），本题不考'), '数据来源多样（见第三章），本题不考')
  assert.equal(stripSourceCitation('字符编码（来源: 教材）'), '字符编码（来源: 教材）')
})

// ---------- 反向护栏：绝不能把不同答案判成相同 ----------

test('反向护栏：SQL 通配符、填空顺序、多选少选都必须区分', () => {
  const pairs: Array<[string, string, string]> = [
    ['王_', '王__', 'SQL LIKE 通配符长度不同'],
    ['王%', '%王%', '通配符位置不同'],
    ['北京###上海', '上海###北京', '填空题顺序有语义'],
    ['键盘###鼠标', '键盘', '多选少选一个'],
  ]
  for (const [a, b, label] of pairs) {
    assert.notEqual(keyOf(a, ''), keyOf(b, ''), `${label} 被误判为同一答案`)
  }
})

test('反向护栏：字母答案与选项正文在判等上保持不同（由输出路径负责映射）', () => {
  // 判等刻意不做字母→正文映射：`B` 与 `传动角` 是两份不同的模型输出文本，
  // 是否等价交给仲裁判断，避免判等层引入语义推断
  assert.notEqual(keyOf('B'), keyOf('传动角'))
})
