/**
 * 判断题答案的同义识别（仅用于「是否一致」判定，不改写任何输出文本）。
 *
 * 背景（实测题库 46 道判断题）：选项一律是 `对` / `错`，
 * 但旧 system 规则要求「answer 只能是「正确」或「错误」」，
 * 导致 43 条答案存成 `正确`/`错误`、只有 3 条命中选项原文。
 * 后果之一是两个模型分别输出 `对` 与 `正确` 时字面不等，
 * 懒投票误判为不一致、白调第三模型。
 *
 * 根治方式是修改指令让模型跟随选项原文（见 answerFewShot.ts 与 server.rs）；
 * 本模块只作为兜底：存量脏数据、以及个别模型不遵守指令时，仍能正确判等。
 *
 * 输入约定：调用方（answerExtract.buildAnswerCompareKey）已完成形状归一
 * （全半角、去空白、小写），因此这里只做**整串精确匹配**，
 * 不再自备一份全半角表，避免两处规则各自漂移。
 */

export type JudgementPolarity = 'true' | 'false'

/**
 * 判断词表，对齐 OCS 源码 packages/core/src/core/worker/resolvers/judgement.ts
 * 的 CORRECT_WORDS / INCORRECT_WORDS（OCS 用它做「答案→选项」的语义匹配）。
 * 全部按「整串相等」匹配，绝不做包含匹配——否则会误伤「对象存储」「错误码」这类正常答案。
 *
 * 与 OCS 的两处刻意差异：
 * 1. 不收 '1' / '0'：OCS 在判断题上下文里认它们，但我们的比较键跨题型通用，
 *    填空题答案恰好是 1 或 0 极其常见，收了会把「1」和「对」误判成同一答案。
 * 2. 不收 'T' / 'F' / 'X'：数学/电路填空题答案写成 x、t 很常见，误伤风险高于收益。
 * 这两类差异只会让偶发的「一个模型输出 T、另一个输出 正确」多调一次模型（保守方向），
 * 不会造成误判一致；而 OCS 侧仍能正确判分，因为它是带题型上下文的匹配。
 */
const POLARITY_WORDS: Record<JudgementPolarity, string[]> = {
  true: ['正确', '对', '是', '√', '✓', 'true', 'yes', '确定', '对的', '是的', '正确的'],
  false: ['错误', '错', '否', '×', '✗', 'false', 'no', '非', '错的', '不对', '不正确的', '不正确', '不是', '不是的']
}

const TRUE_CANONICAL = '正确'
const FALSE_CANONICAL = '错误'

/** 形状归一后的整串若是判断词，返回其极性，否则 null */
export const judgementPolarity = (normalizedAnswer: string): JudgementPolarity | null => {
  const shape = String(normalizedAnswer || '')
  if (!shape) return null
  for (const polarity of ['true', 'false'] as JudgementPolarity[]) {
    if (POLARITY_WORDS[polarity].includes(shape)) return polarity
  }
  return null
}

/**
 * 判断题答案的规范形式：同义答案归一到同一字符串，非判断词原样返回。
 * 因此可以安全地用在通用比较键里。
 */
export const canonicalJudgementAnswer = (normalizedAnswer: string): string => {
  const polarity = judgementPolarity(normalizedAnswer)
  if (!polarity) return normalizedAnswer
  return polarity === 'true' ? TRUE_CANONICAL : FALSE_CANONICAL
}
