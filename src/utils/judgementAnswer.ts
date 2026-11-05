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
 * 判断词表。全部按「整串相等」匹配，绝不做包含匹配——
 * 否则会误伤「对象存储」「错误码」这类正常答案。
 *
 * 刻意不收单字母 t/f/y/n：填空题或英文答案恰好是 `Y` 时会被误归一成「正确」。
 * 实测题库只出现 对/错/正确/错误 四种形态，√/× 与完整英文词一并保留以防其它来源。
 * 词表内一律写成形状归一后的形式（小写、无空白）。
 */
const POLARITY_WORDS: Record<JudgementPolarity, string[]> = {
  true: ['正确', '对', '是', '√', '✓', 'true', 'yes'],
  false: ['错误', '错', '否', '×', '✗', 'false', 'no']
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
