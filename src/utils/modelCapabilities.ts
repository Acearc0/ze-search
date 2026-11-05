/**
 * 模型能力标签解析（阿里云百炼 DashScope 原生 /api/v1/models）。
 *
 * 背景：应用原先拉取用的是 OpenAI 兼容端点 `compatible-mode/v1/models`，
 * 该端点只返回 id/object/created/owned_by，**不含任何能力信息**，
 * 于是「识图」分类只能靠模型命名猜（vl/vision/数字+v）。实测这套启发式并不可靠：
 *   - qwen-image-2.0、wan2.7-image、z-image-turbo 被判成「视觉」，
 *     实际 capabilities=["IG"] 是**文生图**，根本不能识图
 *   - deepseek-v4.1-flash、kimi-k3、qwen3.8-max 被判成「文本」，
 *     实际都含 VU（视觉理解），是可以识图的
 * 原生端点 `GET https://<host>/api/v1/models` 返回 capabilities 字段，是权威依据。
 *
 * 能力码取自线上实测分布（373 个模型）：
 *   TG 文本生成 / VU 视觉理解 / Reasoning 推理 / IG 图片生成 / VG 视频生成
 *   TTS 语音合成 / ASR 语音识别 / TR 向量与排序 / ME / 3D-generation
 *   Multimodal-Omni、Realtime-Omni、Realtime-Chatting、Realtime-Text-to-Speech、
 *   Realtime-Audio-Translate、World-Model
 */

export type ModelCapabilities = string[]

/** 具备视觉理解能力的编码 */
const VISION_CODES = new Set(['VU', 'Multimodal-Omni', 'Realtime-Omni'])

/**
 * 可作为对话/答题模型的能力编码。
 * 注意与「文本页签」区分：qwen3-vl-plus 只有 VU+Reasoning、没有 TG，
 * 它能对话（值得拉取），但它不是文本生成模型。
 */
const CHAT_CODES = new Set(['TG', 'VU', 'Reasoning', 'Multimodal-Omni', 'Realtime-Omni', 'Realtime-Chatting'])

export const isVisionCapable = (capabilities: ModelCapabilities | null | undefined): boolean =>
  !!capabilities && capabilities.some(c => VISION_CODES.has(c))

export const isChatCapable = (capabilities: ModelCapabilities | null | undefined): boolean =>
  !!capabilities && capabilities.some(c => CHAT_CODES.has(c))

/** 真正的文本生成能力 */
export const hasTextGeneration = (capabilities: ModelCapabilities | null | undefined): boolean =>
  !!capabilities && capabilities.includes('TG')

/**
 * 跨端点匹配用的归一化：
 * compatible-mode 会把同一模型暴露成 `cmaas-glm-5.3`，原生端点里是 `glm-5.3`。
 */
export const normalizeModelKey = (id: string): string =>
  String(id || '').trim().toLowerCase().replace(/^cmaas-/, '')

/**
 * 解析 DashScope 原生响应 `{"output":{"total":N,"models":[{model,capabilities,...}]}}`。
 * 结构不符（非百炼供应商、返回 HTML、404 页面等）时返回 null，由调用方回退到命名启发式。
 */
export const parseNativeModelsResponse = (json: unknown): Map<string, ModelCapabilities> | null => {
  const output = (json as any)?.output
  const list = output?.models
  if (!Array.isArray(list) || list.length === 0) return null

  const map = new Map<string, ModelCapabilities>()
  for (const item of list) {
    const modelId = typeof item?.model === 'string' ? item.model.trim() : ''
    if (!modelId) continue
    const caps = Array.isArray(item.capabilities)
      ? item.capabilities.filter((c: unknown): c is string => typeof c === 'string' && !!c.trim())
      : []
    map.set(normalizeModelKey(modelId), caps)
  }

  return map.size > 0 ? map : null
}

/** 原生端点的分页请求地址 */
export const buildNativeModelsPageUrl = (baseUrl: string, pageNo: number, pageSize = 100): string => {
  const host = new URL(baseUrl.trim()).origin
  const query = `page_no=${pageNo}&page_size=${pageSize}`
  return `${host}/api/v1/models?${query}`
}

/**
 * 把能力标签映射成页签归属。
 * 页签语义严格对应能力：文本页签 = 有 TG，识图页签 = 有 VU/Omni。
 * 注意能力是多值的，同一模型可同时属于两个页签（kimi-k3 = TG,VU,Reasoning）。
 * 返回 null 表示无标签，调用方需回退到命名启发式。
 */
export const tabsForCapabilities = (
  capabilities: ModelCapabilities | null | undefined
): { text: boolean; vision: boolean } | null => {
  if (!capabilities || !capabilities.length) return null
  return { text: hasTextGeneration(capabilities), vision: isVisionCapable(capabilities) }
}

/**
 * 能力标签 → 该模型的主分类（用于拉取弹窗的类型预填）。
 * 多能力模型按当前页签偏好取值；只有 VU 没有 TG 的纯视觉模型一律给 vision，
 * 否则会被错误地预填成「文本」。
 */
export const categoryFromCapabilities = (
  capabilities: ModelCapabilities | null | undefined,
  prefer: 'text' | 'vision' = 'text'
): 'text' | 'vision' | null => {
  const tabs = tabsForCapabilities(capabilities)
  if (!tabs) return null
  if (tabs.vision && tabs.text) return prefer === 'vision' ? 'vision' : 'text'
  if (tabs.vision) return 'vision'
  if (tabs.text) return 'text'
  // 无 TG 无 VU（IG/VG/TTS/TR 等）：不属于任何页签，仅在「显示全部」时可见
  return 'text'
}
