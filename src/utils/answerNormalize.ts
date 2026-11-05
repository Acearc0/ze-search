// 显式 .ts 扩展名：本文件会被 node 直跑的单测加载（tsconfig 已开 allowImportingTsExtensions）
import { stripSourceCitation } from './answerExtract.ts'
import { parseOptionLetterMap, stripLeadingOptionLabel } from './optionLabels.ts'

// parseOptionLetterMap / stripLeadingOptionLabel 的实现已移到 optionLabels.ts，
// 由本模块与 answerExtract（比较键）共用，确保「发给 OCS 的答案」与「判等用的答案」口径一致。
export { parseOptionLetterMap, stripLeadingOptionLabel }

/**
 * 将模型答案规范为选项正文：
 * - `ABD` / `A` → 映射选项文字（多选用 ###）
 * - `B. 传动角` → `传动角`
 * - 多空 `A###C` 同样处理
 */
export const normalizeAnswerAgainstOptions = (
  answer: string,
  options?: string | null
): string => {
  const raw = (answer || '').trim()
  if (!raw) return ''

  const map = parseOptionLetterMap(options)
  const parts = raw.includes('###') ? raw.split('###') : [raw]

  const normalized = parts.map((part) => {
    let p = (part || '').trim()
    if (!p) return ''

    // 剥离联网搜索引用来源：答案会被直接判分，链接必须不在其中
    p = stripSourceCitation(p)
    p = stripLeadingOptionLabel(p, map)

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

  // 单段若已在上面展开成多段 ###，避免再包一层
  if (normalized.length === 1 && normalized[0].includes('###') && parts.length === 1) {
    return normalized[0]
  }
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
