/**
 * 模型命名 → 分类（文本 / 视觉）的启发式判断。
 *
 * 用途：拉取模型弹窗按命名预填类型，并按当前页签过滤列表。
 * 这里是「视觉模型被混进文本池」问题的直接源头，故单独成模块以便回归测试。
 */

export type ModelCategoryGuess = 'text' | 'vision'

/**
 * 视觉信号：vl / vision / 4v / image / omni，以及「数字+v」形态（glm-4.6v、glm-5v-turbo）。
 *
 * `[0-9]v(?:-|$)` 要求 v 前面是数字、后面接结尾或连字符，
 * 因此不会把 deepseek-v4-flash、deepseek-v4.1-flash 里的「-v4」误判成视觉。
 */
const VISION_PATTERN = /vision|-vl|vl-|-4v|4v-|image|omni|[0-9]v(?:-|$)/i

export const guessModelCategory = (id: string): ModelCategoryGuess => {
  return VISION_PATTERN.test(String(id || '')) ? 'vision' : 'text'
}

/**
 * 页签 → 应展示的模型分类：总结页签复用文本类模型
 * （与 ModelSettings.filteredModels 中 summary 与 text 同列的行为一致）。
 */
export const tabTargetCategory = (
  tab: 'text' | 'vision' | 'summary'
): ModelCategoryGuess => (tab === 'vision' ? 'vision' : 'text')

/** 该模型 ID 是否属于当前页签 */
export const matchesTab = (id: string, tab: 'text' | 'vision' | 'summary'): boolean => {
  return guessModelCategory(id) === tabTargetCategory(tab)
}
