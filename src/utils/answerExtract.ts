/**
 * 答案提取与比较键归一化。
 *
 * 背景：多模型答题的「懒投票」短路判定与多数票统计，原先直接比较模型整段正文。
 * 模型被要求「最终只输出一行 JSON：{"answer":"..."}」，但实际输出分两类漂移：
 *   1. 部分模型会在 JSON 前多写解释段落（违反指令，但答案本身正确）
 *   2. JSON 序列化风格不同：`{"answer":"X"}` 与 `{"answer": "X"}` 只差一个空格
 * 两者都会让「答案其实一致」被判成不一致，导致懒投票失效（多调一次模型）
 * 并把多数票拆散成平票。因此比较前统一提取 answer 字段再做归一化。
 *
 * 注意：本模块只用于「判定是否一致」，不用于生成展示/下发给后端的文本，
 * 所以归一化可以激进（去空白、全半角、大小写统一）而不影响输出格式。
 */

/** 与 Home.vue 展示层一致：去除 markdown 代码块包裹（内部使用，展示层仍用自己的实现） */
const stripMarkdownCodeBlock = (content: string): string => {
  return (content || '').replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '')
}

/** 从文本末尾提取最后一个大括号平衡的 JSON 片段 */
const extractLastBalancedJson = (s: string): string | null => {
  let end = -1
  let depth = 0

  for (let i = s.length - 1; i >= 0; i--) {
    const ch = s[i]
    if (end === -1) {
      if (ch === '}') {
        end = i
        depth = 1
        continue
      }
      continue
    }
    if (ch === '}') {
      depth++
    } else if (ch === '{') {
      depth--
      if (depth === 0) return s.slice(i, end + 1)
    }
  }

  return null
}

/** 从一个 JSON 对象文本中取 answer（兼容 anwser 拼写错误） */
const readAnswerField = (jsonText: string): string | null => {
  try {
    const obj = JSON.parse(jsonText)
    if (obj && typeof obj === 'object') {
      if (typeof obj.answer === 'string') return obj.answer
      if (typeof obj.anwser === 'string') return obj.anwser
    }
  } catch {
    /* 交给后续回退 */
  }
  return null
}

/**
 * 从模型响应中提取答案正文。
 * 顺序：整体 JSON → 末尾平衡 JSON → 正则回退 → 提取失败返回空串（由调用方回退整段）。
 */
export const extractAnswerFromMixedContent = (text: string): string => {
  const source = stripMarkdownCodeBlock((text || '').trim()).trim()
  if (!source) return ''

  const direct = readAnswerField(source)
  if (direct !== null) return direct

  const tail = extractLastBalancedJson(source)
  if (tail) {
    const fromTail = readAnswerField(tail)
    if (fromTail !== null) return fromTail
  }

  // 正则回退：直接在文本中匹配 answer 字段（覆盖 JSON 本身不合法的情况）
  const matched = source.match(/\{\s*"(?:answer|anwser)"\s*:\s*"([^"]+)"[\s\S]*?\}/s)
  if (matched?.[1]) return matched[1]

  return ''
}

/** 全角标点 → 半角，消除中英文标点风格差异 */
const FULLWIDTH_TO_HALFWIDTH: Record<string, string> = {
  '，': ',', '。': '.', '：': ':', '；': ';', '！': '!', '？': '?',
  '（': '(', '）': ')', '【': '[', '】': ']', '〔': '(', '〕': ')',
  '“': '"', '”': '"', '‘': "'", '’': "'", '、': ',', '　': ' '
}

const toHalfwidth = (text: string): string =>
  text.replace(/[，。：；！（）【】〔〕“”‘’、　]/g, (ch) => FULLWIDTH_TO_HALFWIDTH[ch] ?? ch)

/**
 * 生成用于「是否一致」判定的比较键：
 * 优先取 answer 字段，取不到则退回整段正文；再统一去空白、全半角、大小写。
 * 返回空串表示无可用内容（调用方按「不一致」处理，避免把空响应当成一致）。
 */
export const buildAnswerCompareKey = (content: string): string => {
  const raw = (content || '')
  const answer = extractAnswerFromMixedContent(raw)
  const fallback = stripMarkdownCodeBlock(raw).trim()

  // 报错正文（本 fork 统一以「错误:」前缀呈现）不参与判等：
  // 两个模型返回同一段错误时，不能算作「答案一致」而跳过其余模型。
  // 判断题的合法答案「错误」不带冒号，不会命中此判断。
  if (!answer && /^错误\s*[:：]/.test(fallback)) return ''

  const base = answer || fallback
  if (!base) return ''

  return toHalfwidth(base).replace(/\s+/g, '').toLowerCase()
}

/**
 * 判断两份模型响应是否为同一答案。
 * 任一方无有效内容时一律判为不一致，防止空响应/报错文本被当成「答案一致」。
 */
export const isSameAnswer = (a: string, b: string): boolean => {
  const ka = buildAnswerCompareKey(a)
  const kb = buildAnswerCompareKey(b)
  return !!ka && !!kb && ka === kb
}
