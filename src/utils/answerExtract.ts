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
 * 第三类漂移：判断题同义词。题库选项是「对/错」，旧指令却要求「正确/错误」，
 * 两个模型各按一套输出时字面不等，同样会误触发第三模型，
 * 故比较键额外做判断题同义归一（见 judgementAnswer.ts）。
 *
 * 注意：本模块只用于「判定是否一致」，不用于生成展示/下发给后端的文本，
 * 所以归一化可以激进（去空白、全半角、大小写统一）而不影响输出格式。
 */

// 显式 .ts 扩展名：本文件会被 node 直跑的单测加载（tsconfig 已开 allowImportingTsExtensions）
import { canonicalJudgementAnswer } from './judgementAnswer.ts'
import { parseOptionLetterMap, stripLeadingOptionLabel } from './optionLabels.ts'

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
 * 组装「全部模型失败」时的输出文本。
 *
 * 必须带 `错误:` 前缀：Rust 侧 `is_model_error` 只认前缀（server.rs），
 * 而多模型失败详情是 `[模型名]\n错误: …` 拼接串，会被前缀检查绕过，
 * 进而被当作正常答案提取、入库（实测题库 ID 31 即为此类脏数据）。
 * 已带前缀的内容原样返回，避免二次包裹。
 */
export const buildAllFailureOutput = (detail: string): string => {
  const text = (detail || '').trim()
  if (!text) return '错误: 未获得任何模型响应'
  if (/^错误\s*[:：]/.test(text) || /^Error\s*:/i.test(text)) return text
  return `错误: 所有模型调用失败\n${text}`
}

/**
 * 剥离答案尾部的引用来源。
 *
 * 背景：联网搜索的引导语曾要求模型「在 answer 正文末尾追加来源」，导致来源被写进答案，
 * 进而污染入库文本与发给 OCS 的判分答案（实测题库 ID 135：`字符编码（来源: 1. https://…）`）。
 *
 * 护栏：必须真的含 http(s) 才剥离，避免误伤「资金来源:企业自有资金」这类正常答案；
 * 只锚定尾部，不动正文中间的括号。
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
 * 生成用于「是否一致」判定的比较键：
 * 优先取 answer 字段，取不到则退回整段正文；再剥离来源、剥离选项字母前缀、
 * 归一判断题同义词、统一去空白/全半角/大小写。
 * 返回空串表示无可用内容（调用方按「不一致」处理，避免把空响应当成一致）。
 *
 * @param options   题目选项原文，用于安全剥离 `B. xxx` 前缀（与输出规范化同一依据）
 * @param unordered 答案的 ### 片段是否与顺序无关（多选题是，填空题不是）。
 *                  依据 OCS 源码：resolveMultiple 逐片段独立匹配选项，顺序无关；
 *                  resolveCompletion 按索引对应空位，顺序有语义，故不能无条件排序。
 */
export const buildAnswerCompareKey = (
  content: string,
  opts?: { options?: string | null; unordered?: boolean }
): string => {
  const raw = (content || '')
  const answer = extractAnswerFromMixedContent(raw)
  const fallback = stripMarkdownCodeBlock(raw).trim()

  // 报错正文（本 fork 统一以「错误:」前缀呈现）不参与判等：
  // 两个模型返回同一段错误时，不能算作「答案一致」而跳过其余模型。
  // 判断题的合法答案「错误」不带冒号，不会命中此判断。
  if (!answer && /^错误\s*[:：]/.test(fallback)) return ''

  // 剥离来源：否则「带来源」与「不带来源」的同一答案会被判为不一致，
  // 白白触发仲裁模型（与 123dcae 修的是同一类误判）。
  let base = stripSourceCitation(answer || fallback)
  if (!base) return ''

  // 剥离选项字母前缀：模型常违反「禁止写 B. 传动角」的指令。
  // 必须与发给 OCS 的口径一致——normalizeAnswerAgainstOptions 会剥掉前缀，
  // 若比较键不剥，同一答案会出现「输出干净、判等却不同」的不对称误判。
  const optionMap = parseOptionLetterMap(opts?.options)
  const segments = base.split('###').map((s) => s.trim()).filter(Boolean)
  if (segments.length > 1) {
    const stripped = segments.map((s) => stripLeadingOptionLabel(s, optionMap))
    // 多选题：OCS resolveMultiple 逐片段独立匹配选项，勾选结果与顺序无关 → 排序后比较
    // 填空题：片段按空位索引对应，顺序有语义 → 保持原顺序
    base = (opts?.unordered ? [...stripped].sort() : stripped).join('###')
  } else {
    base = stripLeadingOptionLabel(base, optionMap)
  }

  // 先做形状归一（全半角、去空白、小写），再按归一后的整串匹配判断词：
  // judgementAnswer 约定接收已归一的输入，故「 TRUE 」「√」这类也能命中。
  const shaped = toHalfwidth(base).replace(/\s+/g, '').toLowerCase()

  // 判断题同义归一：题库选项是「对/错」而旧指令要求「正确/错误」，
  // 两个模型各按一套输出时字面不等会误触发第三模型（存量脏数据兜底）。
  return canonicalJudgementAnswer(shaped)
}

/**
 * 判断两份模型响应是否为同一答案。
 * 任一方无有效内容时一律判为不一致，防止空响应/报错文本被当成「答案一致」。
 * opts 与 buildAnswerCompareKey 一致（选项原文、### 片段是否顺序无关）。
 */
export const isSameAnswer = (
  a: string,
  b: string,
  opts?: { options?: string | null; unordered?: boolean }
): boolean => {
  const ka = buildAnswerCompareKey(a, opts)
  const kb = buildAnswerCompareKey(b, opts)
  return !!ka && !!kb && ka === kb
}
