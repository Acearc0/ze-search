/**
 * 选项字母标签（A./B、/C) 等）的解析与剥离。
 *
 * 单独成模块的原因：answerNormalize（输出规范化）与 answerExtract（比较键）
 * 都需要它，而 answerNormalize 已依赖 answerExtract；
 * 若让 answerExtract 反向 import answerNormalize 会形成循环依赖。
 * 本模块不依赖任何其它答案模块，两条链路共用同一实现，
 * 保证「发给 OCS 的答案」与「用于判等的答案」口径一致。
 */

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

    if (optionMap && optionMap.size > 0) {
      const expected = optionMap.get(letter)
      if (expected === rest) return rest
      for (const v of optionMap.values()) {
        if (v === rest) return rest
      }
      continue
    }
    return rest
  }
  return trimmed
}
