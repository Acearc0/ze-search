// 显式 .ts 扩展名：本文件会被 node 直跑的单测加载（tsconfig 已开 allowImportingTsExtensions）
import { parseOptionLetterMap, stripLeadingOptionLabel, splitCleanedAnswerSegments } from './optionLabels.ts'

// parseOptionLetterMap / stripLeadingOptionLabel 的实现已移到 optionLabels.ts，
// 由本模块与 answerExtract（比较键）共用，确保「发给 OCS 的答案」与「判等用的答案」口径一致。
export { parseOptionLetterMap, stripLeadingOptionLabel }

/**
 * 将模型答案规范为选项正文：
 * - `ABD` / `A` → 映射选项文字（多选用 ###）
 * - `B. 传动角` → `传动角`
 * - `"B. 传动角"` / `B. "传动角"` / `"键盘###鼠标"` → 剥包裹后映射
 * - 多空 `A###C` 同样处理
 *
 * OCS 对答案做整串匹配，残留引号或字母前缀都会导致匹配失败。
 * 剥离步骤（剥整体外层 + 切段 + 逐段循环剥离）与判等路径共用
 * splitCleanedAnswerSegments，两条链路对同一文本必然得到同一结果。
 */
export const normalizeAnswerAgainstOptions = (
  answer: string,
  options?: string | null
): string => {
  const raw = (answer || '').trim()
  if (!raw) return ''

  const map = parseOptionLetterMap(options)

  // 切段并逐段剥离来源、字母前缀与包裹引号（与判等路径共用同一实现）。
  // 注意不要在这里先整段 stripSourceCitation：尾部锚定的正则会从来源一路
  // 吞到字符串末尾，把 `北京（来源: https://a）###上海` 里的 `###上海` 一起删掉。
  const segments = splitCleanedAnswerSegments(raw, map)

  const normalized = segments.map((p) => {
    // 纯字母答案（A / ABD）映射为选项正文
    const compact = p.replace(/\s+/g, '')
    if (map.size > 0 && /^[A-Za-z]{1,8}$/.test(compact)) {
      const letters = compact.toUpperCase().split('')
      const texts = letters.map((ch) => map.get(ch)).filter((t): t is string => !!t)
      if (texts.length === letters.length && texts.length > 0) {
        return texts.join('###')
      }
    }
    return p
  }).filter(Boolean)

  return normalized.join('###')
}

/** 若 content 是 {"answer":"..."} JSON，则规范化其中的 answer */
export const normalizeAnswerJsonContent = (
  content: string,
  options?: string | null
): string => {
  const trimmed = (content || '').trim()
  if (!trimmed) return trimmed

  const tryObj = (text: string): string | null => {
    try {
      const obj = JSON.parse(text)
      if (obj && typeof obj === 'object' && typeof obj.answer === 'string') {
        const next = normalizeAnswerAgainstOptions(obj.answer, options)
        if (next !== obj.answer) {
          return JSON.stringify({ ...obj, answer: next })
        }
        return text
      }
    } catch {
      /* ignore */
    }
    return null
  }

  const direct = tryObj(trimmed)
  if (direct != null) return direct

  // 从末尾抽 JSON
  const end = trimmed.lastIndexOf('}')
  if (end >= 0) {
    let depth = 0
    for (let i = end; i >= 0; i--) {
      if (trimmed[i] === '}') depth++
      else if (trimmed[i] === '{') {
        depth--
        if (depth === 0) {
          const frag = trimmed.slice(i, end + 1)
          const replaced = tryObj(frag)
          if (replaced != null && replaced !== frag) {
            return trimmed.slice(0, i) + replaced + trimmed.slice(end + 1)
          }
          break
        }
      }
    }
  }

  // 非 JSON：整段当答案规范化
  if (!trimmed.startsWith('{') && !trimmed.startsWith('错误:')) {
    return normalizeAnswerAgainstOptions(trimmed, options)
  }
  return trimmed
}
