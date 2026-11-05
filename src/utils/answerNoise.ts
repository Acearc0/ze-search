/**
 * 答案外层包裹符号（引号/书名号）的识别与剥离。
 *
 * 单独成模块且**不依赖任何其它答案模块**的原因：
 * optionLabels（选项字母前缀剥离）与 answerExtract（比较键）都需要它，
 * 而 optionLabels 与 answerExtract 之间存在依赖方向，
 * 若把引号工具放在任一侧都会形成循环依赖。
 *
 * 背景：模型对「答案要不要带引号」没有统一习惯。实测同一道 SQL 题
 * （选项含 `王_`），qwen3.8-flash 输出 `王_`，deepseek-v4.1-flash 输出 `"王_"`
 * （答案里带字面双引号），两者语义相同却判为不一致，白白调用仲裁模型。
 */

/**
 * 成对包裹符。刻意不含【】〈〉等可能属于答案本身的符号
 * （填空题答案可能真含方括号），也不含括号 () —— 括注有时是答案的一部分。
 */
const WRAPPING_PAIRS: Array<[string, string]> = [
  ['"', '"'],
  ['“', '”'],
  ['‘', '’'],
  ["'", "'"],
  ['`', '`'],
  ['「', '」'],
  ['『', '』']
]

/** 首尾成对包裹时返回剥掉的内部文本，否则 null */
export const unwrapOuterPair = (text: string): string | null => {
  const t = (text || '').trim()
  if (t.length < 2) return null
  const pair = WRAPPING_PAIRS.find(([open, close]) => t.startsWith(open) && t.endsWith(close))
  if (!pair) return null
  // 内层为空则不剥，避免把 `"a"` 这类合法答案剥没
  const inner = t.slice(pair[0].length, t.length - pair[1].length).trim()
  return inner || null
}

/** 反复剥离外层成对包裹（最多 4 层，防御 `"“王_”"` 这类叠加） */
export const stripWrappingQuotes = (answer: string): string => {
  let text = (answer || '').trim()
  for (let round = 0; round < 4; round++) {
    const inner = unwrapOuterPair(text)
    if (inner === null) break
    text = inner
  }
  return text
}

/**
 * 剥离答案尾部的引用来源。
 *
 * 背景：联网搜索的引导语曾要求模型「在 answer 正文末尾追加来源」，导致来源被写进答案，
 * 进而污染入库文本与发给 OCS 的判分答案（实测题库 ID 135：`字符编码（来源: 1. https://…）`）。
 *
 * 护栏：必须真的含 http(s) 才剥离，避免误伤「资金来源:企业自有资金」这类正常答案；
 * 只锚定尾部，不动正文中间的括号。
 *
 * 必须**逐段**调用而非对整段答案调用：`北京（来源: https://a）###上海` 若整段剥离，
 * 尾部锚定的正则会从来源一路吞到字符串末尾，把 `###上海` 一起删掉。
 */
export const stripSourceCitation = (answer: string): string => {
  const raw = (answer || '').trim()
  if (!raw) return ''

  // （来源: 1. https://a 2. https://b） / (来源：https://a) / 来源: https://a / SOURCES: 1. https://a
  const stripped = raw
    .replace(/[（(\s]*(?:参考|引用)?来源\s*[:：][\s\S]*?https?:\/\/\S[\s\S]*$/iu, '')
    .replace(/[（(\s]*SOURCES\s*[:：][\s\S]*?https?:\/\/\S[\s\S]*$/i, '')
    .trim()

  // 残留的悬挂标点/左括号
  return stripped.replace(/[（(，,、；;：:\s]+$/u, '').trim()
}

/**
 * 片段是否残留「孤立引号」（只在一端）。
 * 用于判断能否安全剥掉整体包裹：`"键盘###鼠标"` 剥掉后各段干净（可剥），
 * 而 `"键盘"###"鼠标"` 剥掉后会出现 `键盘"` 这种孤立引号（不可剥，应逐段处理）。
 */
export const hasDanglingQuote = (segment: string): boolean => {
  const t = (segment || '').trim()
  if (!t) return false
  const starts = WRAPPING_PAIRS.some(([open]) => t.startsWith(open))
  const ends = WRAPPING_PAIRS.some(([, close]) => t.endsWith(close))
  return starts !== ends
}
