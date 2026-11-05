/**
 * 选项字母标签（A./B、/C) 等）的解析与剥离。
 *
 * 单独成模块的原因：answerNormalize（输出规范化）与 answerExtract（比较键）
 * 都需要它，而 answerNormalize 已依赖 answerExtract；
 * 若让 answerExtract 反向 import answerNormalize 会形成循环依赖。
 * 本模块不依赖任何其它答案模块，两条链路共用同一实现，
 * 保证「发给 OCS 的答案」与「用于判等的答案」口径一致。
 */

// 显式 .ts 扩展名：本文件会被 node 直跑的单测加载（tsconfig 已开 allowImportingTsExtensions）
import { stripWrappingQuotes, unwrapOuterPair, hasDanglingQuote, stripSourceCitation } from './answerNoise.ts'

/** 从选项文本解析 A/B/C → 选项正文 */
export const parseOptionLetterMap = (options: string | undefined | null): Map<string, string> => {
  const map = new Map<string, string>()
  if (!options?.trim()) return map
  for (const raw of options.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const m = line.match(/^([A-Za-z])([\.、．\)])\s*(.+)$/)
    if (!m?.[1] || !m[3]?.trim()) continue
    const sep = m[2]
    const rest = m[3].trim()
    // 避免把正文「C、H、O、N…」误当成选项标号行
    if (sep === '、' && /^[A-Za-z]、/.test(rest)) continue
    map.set(m[1].toUpperCase(), rest)
  }
  return map
}

/**
 * 去掉行首选项字母前缀：`B. 传动角` → `传动角`；纯字母保留给后续映射。
 * 有选项表时，仅当去前缀后能对应到某选项正文才剥离，避免误伤「C、H、O、N…」。
 */
export const stripLeadingOptionLabel = (
  text: string,
  optionMap?: Map<string, string>
): string => {
  const trimmed = (text || '').trim()
  if (!trimmed) return ''

  const attempts: RegExpMatchArray[] = []
  const mSpace = trimmed.match(/^([A-Za-z])([\.、．\)])\s+(.+)$/)
  if (mSpace) attempts.push(mSpace)
  const mTight = trimmed.match(/^([A-Za-z])([\.、．\)])(.+)$/)
  if (mTight && mTight !== mSpace) attempts.push(mTight)

  for (const m of attempts) {
    const letter = m[1].toUpperCase()
    const sep = m[2]
    const rest = (m[3] || '').trim()
    if (!rest) continue
    // 无空格且剩余全是字母：留给纯字母映射（如 ABD）
    if (!/\s/.test(m[0].slice(1, 3)) && /^[A-Za-z]+$/.test(rest) && rest.length <= 8) {
      continue
    }
    // 无选项表时不用中文顿号做激进剥离
    if ((!optionMap || optionMap.size === 0) && sep === '、') continue

    // 剩余部分可能整体被引号包裹（`B. "传动角"`）。若允许剥掉这层包裹后再比对，
    // 才能命中选项正文；否则前缀剥离与引号剥离会互相阻塞（谁都需要先让对方一步）。
    const restBare = stripWrappingQuotes(rest)

    if (optionMap && optionMap.size > 0) {
      const candidates = restBare !== rest ? [rest, restBare] : [rest]
      for (const c of candidates) {
        if (optionMap.get(letter) === c) return c
        for (const v of optionMap.values()) {
          if (v === c) return c
        }
      }
      continue
    }
    // 无选项表：无法校验，返回剥掉包裹后的正文（`B. "传动角"` → `传动角`），
    // 与有选项表时的口径保持一致，避免输出路径残留引号导致 OCS 整串匹配失败
    return restBare
  }
  return trimmed
}

/**
 * 反复剥离片段外层的包裹噪声（引号包裹、选项字母前缀），直到不再变化。
 *
 * 两类剥离存在顺序依赖：`B. "传动角"` 要先剥前缀才露出可剥的引号，
 * `"B. 传动角"` 要先剥引号才露出前缀。单次处理任一种都会漏掉另一种，
 * 故循环到稳定（上限 6 轮，防御异常输入）。
 *
 * 输出路径（normalizeAnswerAgainstOptions）与判等路径（buildAnswerCompareKey）
 * 共用本函数，确保「发给 OCS 的文本」与「用于判等的文本」口径一致：
 * OCS 对答案做整串匹配，残留引号或字母前缀都会导致匹配失败。
 */
export const stripSegmentNoise = (text: string, optionMap?: Map<string, string>): string => {
  let current = (text || '').trim()
  for (let round = 0; round < 6; round++) {
    const next = stripLeadingOptionLabel(stripWrappingQuotes(current), optionMap).trim()
    if (!next || next === current) break
    current = next
  }
  return current
}

/**
 * 剥离答案整体的包裹噪声，返回清理后的 ### 片段数组。
 *
 * 两步存在顺序依赖：
 * 1. 整体被引号包裹（`"键盘###鼠标"`）时先剥外层再切段；
 *    但逐段各自包裹（`"键盘"###"鼠标"`）不能剥整体，否则会留下孤立引号；
 * 2. 逐段循环剥离引号与选项字母前缀。
 *
 * 输出路径（normalizeAnswerAgainstOptions）与判等路径（buildAnswerCompareKey）
 * 共用本函数，两条链路对同一段文本必然得到同一结果，不会各自漂移。
 * 是否对片段排序由调用方按题型决定（多选顺序无关、填空顺序有语义）。
 */
export const splitCleanedAnswerSegments = (
  answer: string,
  optionMap?: Map<string, string>
): string[] => {
  const raw = (answer || '').trim()
  if (!raw) return []

  const outer = unwrapOuterPair(raw)
  const body = outer !== null && !hasDanglingQuote(outer.split('###')[0]) ? outer : raw

  return body
    .split('###')
    // 来源必须逐段剥离：整段剥离时尾部锚定的正则会从来源一路吞到末尾，
    // 把 `北京（来源: https://a）###上海` 里的 `###上海` 一起删掉
    .map((s) => stripSegmentNoise(stripSourceCitation(s), optionMap))
    .filter(Boolean)
}
