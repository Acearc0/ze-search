import type { AIModel } from '../model/config'
import { resolveModelApiProtocol } from '../model/config'
import { resolveExecutableModelJsCode, resolveRuntimeModelId } from '../model/protocol'
import { resolveModelOutputLimit } from '../model/contextBudget'
import { createBuiltinProvider } from '../model/providers'
import { secureFetch } from '../security/secureFetch'
import { buildAnswerChatMessages } from '../../utils/answer/answerFewShot'
import { modelApi, settingsApi } from './deps'
import {
  assertSuccessfulModelResponse,
  trackModelHttpOutcome,
  createCancelledRequestError,
  formatModelCallError,
  isAbortLikeError,
} from './errors'
import {
  isRequestCancelled,
  registerAbortController,
  unregisterAbortController,
  updateStreamingReasoning,
  updateStreamingResponse,
  updateRequestDetailsWithModelReasoning,
} from './runtime'
import { sendModelProgressToBackend } from './backend'
import {
  WEB_SEARCH_TOOL,
  executeWebSearchToolCall,
  type WebSearchSettings,
} from '../freeWebSearch'
import { normalizeSearchSettings } from '../searchProviders'

const { settings } = settingsApi
const { platforms } = modelApi

/**
 * provider='free' 时把 web_search 作为 function call 注入模型，由模型按需触发。
 * 其它 provider 仍走官方的「预搜 + 拼 prompt」，不注入工具，保持既有行为。
 */
const resolveFreeSearchConfig = (): WebSearchSettings | null => {
  const raw = normalizeSearchSettings(settings.search)
  if (!raw.enabled || raw.provider !== 'free') return null
  return {
    enabled: true,
    engine: 'bing',
    apiKey: '',
    maxResults: 5,
    timeoutSeconds: 15,
    searxngInstances: ''
  }
}

export const getModelRetryCount = () => {
  const n = Number(settings.modelRetryCount)
  if (!Number.isFinite(n) || n < 0) return 2
  return Math.min(10, Math.floor(n))
}

/**
 * 百炼联网的模型白名单，分协议（官方文档「支持的模型」）：
 * - Chat Completions（enable_search）：千问 qwen-max/plus/flash、qwen3.5~3.8、qwen4、
 *   DeepSeek v4 系列。GLM 5.2 与 Kimi k3/k3.1-pro 在该协议下不支持。
 * - Responses（web_search 工具）：上述全部，外加 glm-5.2、kimi-k3、kimi-k3.1-pro，
 *   以及 Omni 系列（其内置工具只支持 web_search）。
 */
const BAILIAN_CHAT_SEARCH_RE = /^(?:qwen-(?:max|plus|flash)|qwen(?:3\.[5-9]|4)(?!.*omni)|deepseek-v4)/i
const BAILIAN_RESPONSES_SEARCH_RE = /^(?:qwen-(?:max|plus|flash)|qwen(?:3\.[5-9]|4)|deepseek-v4|glm-5\.2|kimi-k3)/i

/**
 * provider='bailian'：不注入工具、不做预搜，直接在模型请求里带 enable_search / web_search，
 * 由百炼服务端完成联网（国内直连，不依赖 bing/ddg 这些在墙外或返回降级结果的引擎）。
 */
const resolveBailianSearchEnabled = (model: AIModel, protocol: string): boolean => {
  const raw = normalizeSearchSettings(settings.search)
  if (!raw.enabled || raw.provider !== 'bailian') return false
  const id = String(model?.modelId || model?.id || '').toLowerCase()
  const re = protocol === 'openai-response' ? BAILIAN_RESPONSES_SEARCH_RE : BAILIAN_CHAT_SEARCH_RE
  return re.test(id)
}

/**
 * GLM 5.2 / Kimi k3 这类模型在 Chat 协议下不认 enable_search，只在 Responses 协议下能挂
 * web_search 工具。选百炼联网时自动把本次请求切到 Responses，省得用户手动改协议；
 * 显式配置成 responses 的模型本来就满足，不会重复处理。
 */
const resolveEffectiveSearchProtocol = (
  model: AIModel,
  platform: { apiProtocol?: string } | undefined
): { protocol: string; enableSearch: boolean; autoSwitched: boolean } => {
  const base = resolveModelApiProtocol(model, platform as any)
  const chatSupported = resolveBailianSearchEnabled(model, 'openai-chat')
  const responseSupported = resolveBailianSearchEnabled(model, 'openai-response')
  const autoSwitched = base === 'openai-chat' && !chatSupported && responseSupported
  const protocol = autoSwitched ? 'openai-response' : base
  return {
    protocol,
    enableSearch: resolveBailianSearchEnabled(model, protocol),
    autoSwitched
  }
}

export const shouldSkipModelRetry = (error: unknown, requestId: string) => {
  // 超时/取消是确定性失败，重试只会让用户多等一轮，并且可把已经超时的请求再拖 40 秒
  return isRequestCancelled(requestId) || isAbortLikeError(error)
}

export const withModelRetry = async <T>(
  requestId: string,
  label: string,
  enabled: boolean,
  fn: (attempt: number, maxAttempts: number) => Promise<T>,
  onRetry?: (attempt: number, maxAttempts: number, error: unknown) => void
): Promise<T> => {
  const maxAttempts = enabled ? getModelRetryCount() + 1 : 1
  let lastError: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (isRequestCancelled(requestId)) throw createCancelledRequestError()
    try {
      return await fn(attempt, maxAttempts)
    } catch (error) {
      lastError = error
      if (shouldSkipModelRetry(error, requestId) || attempt >= maxAttempts) throw error
      console.warn(`[模型重试 ${attempt}/${maxAttempts}] ${label}:`, formatModelCallError(error))
      onRetry?.(attempt, maxAttempts, error)
      await new Promise((resolve) => setTimeout(resolve, Math.min(2000, 400 * attempt)))
    }
  }
  throw lastError
}

export const stripMarkdownCodeBlock = (content: string): string => {
  return content.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '')
}

/** 拼装多模型输出：成功内容或真实报错原文，不使用统一失败文案 */
export const formatModelOutputs = (
  entries: Array<{ model: { displayName: string }; response: string }>
): string => {
  const usable = entries.filter(e => (e.response || '').trim())
  if (usable.length === 0) return ''
  if (usable.length === 1) return usable[0].response
  return usable.map(e => `[${e.model.displayName}]\n${e.response}`).join('\n\n')
}

export const normalizeAnswerForComparison = (content: string): string => {
  return stripMarkdownCodeBlock(content || '')
    .replace(/\s+/g, ' ')
    .trim()
}

export const getMostFrequentSuccessfulAnswer = (responses: string[]): string => {
  const answerStats = new Map<string, { count: number; firstIndex: number; original: string }>()

  responses.forEach((response, index) => {
    const original = stripMarkdownCodeBlock(response).trim()
    const key = normalizeAnswerForComparison(original)
    if (!key) return

    const existing = answerStats.get(key)
    if (existing) {
      existing.count += 1
      return
    }

    answerStats.set(key, {
      count: 1,
      firstIndex: index,
      original,
    })
  })

  let selected: { count: number; firstIndex: number; original: string } | null = null
  for (const stat of answerStats.values()) {
    if (
      !selected ||
      stat.count > selected.count ||
      (stat.count === selected.count && stat.firstIndex < selected.firstIndex)
    ) {
      selected = stat
    }
  }

  return selected?.original || ''
}

export const getReasoningContentValue = (payload: any): string => {
  const candidates = [
    payload?.reasoning_content,
    payload?.reasoningContent,
    payload?.reasoning,
    payload?.delta?.reasoning_content,
    payload?.delta?.reasoningContent,
    payload?.delta?.reasoning,
    payload?.message?.reasoning_content,
    payload?.message?.reasoningContent,
    payload?.message?.reasoning,
    payload?.choices?.[0]?.delta?.reasoning_content,
    payload?.choices?.[0]?.delta?.reasoningContent,
    payload?.choices?.[0]?.delta?.reasoning,
    payload?.choices?.[0]?.message?.reasoning_content,
    payload?.choices?.[0]?.message?.reasoningContent,
    payload?.choices?.[0]?.message?.reasoning
  ]

  const reasoning = candidates.find(value => typeof value === 'string' && value.length > 0)
  return typeof reasoning === 'string' ? reasoning : ''
}


export const callModelWithStreaming = async (

  model: AIModel,
  query: string,
  requestId: string,
  onChunk?: (content: string) => void,
  onReasoning?: (text: string) => void,
  searchContext?: string
) => {
  if (isRequestCancelled(requestId)) {
    throw createCancelledRequestError()
  }

  const runtimeModelId = resolveRuntimeModelId(model)
  // 获取模型所属的平台
  const platform = platforms.value.find(p => p.models.some(m => m.id === model.id))
  const executableCode = resolveExecutableModelJsCode(model, platform)

  if (!platform) {
    console.error('未找到模型所属平台 - 详细信息:')
    console.error('- 模型ID:', model.id)
    console.error('- 模型平台ID:', model.platformId)
    console.error('- 所有平台:', platforms.value.map(p => ({
      id: p.id,
      name: p.displayName,
      modelIds: p.models.map(m => m.id)
    })))
    throw new Error('未找到模型所属平台')
  }

  // 构建测试输入数据（普通答题注入典型例题多轮对话）
  const chatMessages = buildAnswerChatMessages(query)
  // GLM 5.2 / Kimi k3 在 Chat 协议下不认 enable_search，选了百炼联网时自动切 Responses
  const searchPlan = resolveEffectiveSearchProtocol(model, platform)
  const adapterModel: AIModel = searchPlan.autoSwitched
    ? { ...model, apiProtocol: 'openai-response' }
    : model
  const adapterPlatform = searchPlan.autoSwitched
    ? { ...platform, apiProtocol: 'openai-response' as const }
    : platform
  if (searchContext) {
    const lastUserMessage = [...chatMessages].reverse().find(message => message.role === 'user')
    if (lastUserMessage) lastUserMessage.content = `${searchContext}\n\n${lastUserMessage.content}`
    else chatMessages.push({ role: 'user', content: searchContext })
  }
  // provider='free'：注入 web_search function tool，模型自行决定何时搜索；
  // 同时在 system 规则里追加引导，否则模型不会主动调用工具
  const freeSearchConfig = resolveFreeSearchConfig()
  if (freeSearchConfig) {
    const sys = chatMessages.find(m => m.role === 'system')
    if (sys) {
      sys.content += '\n当题目涉及时效性信息或你不确定的事实、需要外部资料佐证时，先调用 web_search 工具（参数 query 为题目核心关键词，去掉选项文本与题号），拿到结果后再按上述规则输出答案 JSON。搜索结果仅作校验，answer 只写答案正文，严禁写入网址或来源说明。'
    }
  }
  const testInput: any = {
    messages: chatMessages,
    model: runtimeModelId,
    stream: true,
    tools: freeSearchConfig ? [WEB_SEARCH_TOOL] : []
  }

  // 构建配置对象
  const config = {
    ...model,
    apiKey: modelApi.getPlatformApiKey(platform),
    customHeaders: platform.customHeaders,
    maxTokens: resolveModelOutputLimit(model),
    baseUrl: platform.baseUrl,
    model: runtimeModelId,
    modelId: runtimeModelId,
    // 百炼内置联网：由 provider 层在 payload 里加 enable_search / web_search
    enableSearch: searchPlan.enableSearch
  }

  // 读取超时配置（秒转毫秒）
  const timeoutMs = (settings.modelResponseTimeout ?? 40) * 1000

  // AbortController 用于超时中断 fetch
  const abortController = new AbortController()
  registerAbortController(requestId, abortController)
  // 工具调用（联网搜索）会额外耗时，模型那头不应该继续吃同一份超时预算，
  // 所以每次执行工具前重置计时器。
  let timeoutHandle = setTimeout(() => {
    if (!isRequestCancelled(requestId)) {
      abortController.abort(new DOMException(`模型响应超时（${Math.round(timeoutMs / 1000)} 秒）`, 'TimeoutError'))
    } else {
      abortController.abort()
    }
  }, timeoutMs)
  const armTimeout = () => {
    clearTimeout(timeoutHandle)
    timeoutHandle = setTimeout(() => {
      if (!isRequestCancelled(requestId)) {
        abortController.abort(new DOMException(`模型响应超时（${Math.round(timeoutMs / 1000)} 秒）`, 'TimeoutError'))
      } else {
        abortController.abort()
      }
    }, timeoutMs)
  }

  const rawTauriFetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    try {
      return await secureFetch(input, {
        ...init,
        credentials: init.credentials ?? 'include',
        signal: init.signal ?? abortController.signal
      })
    } catch (error) {
      if (isAbortLikeError(error)) throw error
      throw new Error(formatModelCallError(error, '网络请求失败'))
    }
  }

  const transport = trackModelHttpOutcome(rawTauriFetch)
  const tauriFetch = transport.fetch

  // 执行JavaScript配置代码
  if (executableCode) {
    // 创建一个安全的执行环境
    let processModel: any = createBuiltinProvider(adapterModel, adapterPlatform)

    if (!processModel && (executableCode.startsWith('async function') || executableCode.startsWith('function'))) {
      const safeEval = new Function('input', 'config', 'fetch', 'abortSignal', `
        ${executableCode}
        return processModel;
      `)
      processModel = safeEval(testInput, config, tauriFetch, abortController.signal)
    } else if (!processModel) {
      const wrapperFunction = new Function('input', 'config', 'fetch', 'abortSignal', `
        return (async function processModel(input, config) {
          ${executableCode}
        });
      `)
      processModel = wrapperFunction(testInput, config, tauriFetch, abortController.signal)
    }

    let keepaliveTimer: ReturnType<typeof setInterval> | null = null
    try {
      let fullResponse = ''
      let fullReasoning = ''
      let lastProgressSentAt = 0

      // 立即心跳，避免后台启动时 60s 内无任何 progress → 408
      void sendModelProgressToBackend(requestId, 'started')

      // 常驻 keepalive（不仅思考模型）：后台 WebView 节流时尽量维持后端活动时钟
      keepaliveTimer = setInterval(() => {
        sendModelProgressToBackend(requestId, fullResponse || 'keepalive')
      }, 2000)

      let toolRounds = 0
      while (true) {
        // 防止模型反复调用工具导致死循环（尤其免费搜索这种无 Key 工具）
        if (toolRounds > 4) throw new Error('工具调用轮次超过上限（4）')
        // 执行模型调用
        const result = await processModel(testInput, config, tauriFetch, abortController.signal)
        transport.assertSuccess()

        assertSuccessfulModelResponse(result)
        if (result) {
          // 如果返回的是生成器或异步迭代器，进行流式处理
          if (result[Symbol.asyncIterator]) {
            let toolCalls: any[] = []

            for await (const chunk of result) {
              assertSuccessfulModelResponse(chunk)
              if (chunk.tool_calls) {
                for (const tc of chunk.tool_calls) {
                  const existing = toolCalls.find(t => t.id === tc.id)
                  if (existing) {
                    existing.function.arguments += (tc.function?.arguments || '')
                  } else {
                    toolCalls.push(tc)
                  }
                }
              }
              if (chunk.content) {
                fullResponse += chunk.content
                // 实时更新UI显示
                if (onChunk) {
                  onChunk(fullResponse)
                } else {
                  updateStreamingResponse(requestId, fullResponse)
                }
                const now = Date.now()
                if (now - lastProgressSentAt > 800) {
                  sendModelProgressToBackend(requestId, fullResponse)
                  lastProgressSentAt = now
                }
              }
              const rc = getReasoningContentValue(chunk)
              if (rc) {
                fullReasoning += rc
                if (onReasoning) {
                  onReasoning(fullReasoning)
                } else {
                  updateStreamingReasoning(requestId, fullReasoning)
                }
              }
            }

            if (toolCalls.length > 0) {
              testInput.messages.push({ role: 'assistant', content: '', tool_calls: toolCalls })

              for (const tc of toolCalls) {
                try {
                  // 不把工具调用提示拼进 fullResponse（它是最终答案），
                  // 仅通过进度事件告知后端，避免污染判分文本
                  void sendModelProgressToBackend(requestId, `正在调用工具: ${tc.function.name}`)

                  // 搜索可能耗时十几秒，重置模型侧超时，避免工具还没回来就被判超时
                  armTimeout()

                  let toolResult = ''
                  if (freeSearchConfig && tc.function?.name === 'web_search') {
                    toolResult = await executeWebSearchToolCall(
                      tc.function.arguments || '',
                      freeSearchConfig,
                      abortController.signal
                    )
                  } else {
                    toolResult = `Error: Unknown function ${tc.function?.name || '(unnamed)'}`
                  }

                  // 工具结果只回传给模型，不拼进 fullResponse：
                  // fullResponse 是最终答案，混入搜索原文会污染判分文本与 UI 展示
                  testInput.messages.push({ role: 'tool', tool_call_id: tc.id, name: tc.function.name, content: toolResult })
                } catch (e: any) {
                  // 只在整个请求被取消/超时时向上抛；搜索自身超时不算请求失败，
                  // 要走下面的分支交给模型凭自身知识继续作答
                  if (isRequestCancelled(requestId) || abortController.signal.aborted) {
                    throw e
                  }
                  // 真正的工具失败也只回传给模型，绝不拼进 fullResponse（那是判分文本）
                  testInput.messages.push({
                    role: 'tool',
                    tool_call_id: tc.id,
                    name: tc.function.name,
                    content: `Error: ${e.message || String(e)}`
                  })
                }
              }
              
              // tool calls processed, loop again
              toolRounds++
              continue;
            }

            if (fullReasoning) {
              if (onReasoning) {
                onReasoning(fullReasoning)
              } else {
                updateRequestDetailsWithModelReasoning(requestId, fullReasoning)
              }
            }
            transport.assertSuccess()
            if (!fullResponse.trim()) throw new Error('模型返回空内容')
            assertSuccessfulModelResponse(fullResponse)
            return fullResponse
          } else {
            // 非流式响应，直接返回
            const response = typeof result === 'string'
              ? result
              : typeof result?.content === 'string'
                ? result.content
                : JSON.stringify(result)
            const reasoning = typeof result === 'string' ? '' : getReasoningContentValue(result)

            if (reasoning) {
              if (onReasoning) {
                onReasoning(reasoning)
              } else {
                updateStreamingReasoning(requestId, reasoning)
              }
            }
            if (onChunk) {
              onChunk(response)
            } else {
              updateStreamingResponse(requestId, response)
            }
            return response
          }

        } else {
          throw new Error('模型配置代码未返回有效结果')
        }
      }
    } catch (error) {
      if (isRequestCancelled(requestId)) {
        throw createCancelledRequestError()
      }
      if (isAbortLikeError(error)) {
        throw new Error(`模型响应超时（${Math.round(timeoutMs / 1000)} 秒）或连接被中断`)
      }
      throw new Error(formatModelCallError(error))
    } finally {
      clearTimeout(timeoutHandle)
      if (keepaliveTimer !== null) clearInterval(keepaliveTimer)
      unregisterAbortController(requestId, abortController)
    }
  } else {
    clearTimeout(timeoutHandle)
    unregisterAbortController(requestId, abortController)
    throw new Error('模型未配置可执行代码')
  }
}


export const callModel = async (model: AIModel, query: string) => {
  const runtimeModelId = resolveRuntimeModelId(model)
  const platform = platforms.value.find(p => p.models.some(m => m.id === model.id))
  const executableCode = resolveExecutableModelJsCode(model, platform)
  if (!platform) {
    throw new Error('未找到模型所属平台')
  }
  const searchPlan = resolveEffectiveSearchProtocol(model, platform)
  const adapterModel: AIModel = searchPlan.autoSwitched
    ? { ...model, apiProtocol: 'openai-response' }
    : model
  const adapterPlatform = searchPlan.autoSwitched
    ? { ...platform, apiProtocol: 'openai-response' as const }
    : platform

  // 构建测试输入数据
  const testInput = {
    messages: [
      {
        role: 'user',
        content: query
      }
    ],
    model: runtimeModelId,
    stream: true
  }

  // 构建配置对象
  const config = {
    ...model,
    apiKey: modelApi.getPlatformApiKey(platform),
    customHeaders: platform.customHeaders,
    maxTokens: resolveModelOutputLimit(model),
    baseUrl: platform.baseUrl,
    model: runtimeModelId,
    modelId: runtimeModelId,
    enableSearch: searchPlan.enableSearch
  }

  const tauriFetch = (input: RequestInfo | URL, init: RequestInit = {}) =>
    secureFetch(input, {
      ...init,
      credentials: init.credentials ?? 'include'
    })

  // 执行JavaScript配置代码
  if (executableCode) {
    // 创建一个安全的执行环境
    let processModel: any = createBuiltinProvider(adapterModel, adapterPlatform)

    if (!processModel && (executableCode.startsWith('async function') || executableCode.startsWith('function'))) {
      // 如果是完整的函数声明，使用eval在安全环境中执行
      const safeEval = new Function('input', 'config', 'fetch', `
        ${executableCode}
        return processModel;
      `)
      processModel = safeEval(testInput, config, tauriFetch)
    } else if (!processModel) {
      // 如果是函数体，包装为async函数
      const wrapperFunction = new Function('input', 'config', 'fetch', `
        return (async function processModel(input, config) {
          ${executableCode}
        });
      `)
      processModel = wrapperFunction(testInput, config, tauriFetch)
    }

    // 执行模型调用
    const result = await processModel(testInput, config, tauriFetch)

    if (result) {
      // 如果返回的是生成器或异步迭代器，收集结果
      if (result[Symbol.asyncIterator]) {
        let fullResponse = ''
        for await (const chunk of result) {
          if (chunk.content) {
            fullResponse += chunk.content
          }
        }
        return fullResponse
      } else {
        return result
      }
    } else {
      throw new Error('模型配置代码未返回有效结果')
    }
  } else {
    throw new Error('模型未配置可执行代码')
  }
}

