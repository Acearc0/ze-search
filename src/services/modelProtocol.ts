import type { AIModel } from './modelConfig'

type ApiProtocol = AIModel['apiProtocol']

export const normalizeApiProtocol = (protocol?: string | null): ApiProtocol => {
  switch (protocol) {
    case 'openai-chat':
    case 'openai-response':
    case 'anthropic':
    case 'custom':
      return protocol
    case 'OpenAI':
    case 'openai':
      return 'openai-chat'
    case 'Responses':
      return 'openai-response'
    case 'Anthropic':
      return 'anthropic'
    default:
      return 'openai-chat'
  }
}

export const readModelIdFromJsCode = (code?: string | null): string | null => {
  if (!code) return null
  const match = code.match(/model\s*:\s*(['"`])([^'"`\n]*?)\1/)
  return match ? match[2] : null
}

export const resolveRuntimeModelId = (
  model?: Partial<Pick<AIModel, 'id' | 'modelId'>>
): string => {
  // 统一：请求只用 modelId（同步/服务端保证有值）；极端缺省再回退 id
  return model?.modelId?.trim() || model?.id || ''
}

export type ThinkingRuntimeOptions = {
  enableThinking?: boolean
  thinkingOffEnableThinkingFalse?: boolean
  thinkingOffThinkingTypeDisabled?: boolean
  thinkingOffResponsesEffort?: AIModel['thinkingOffResponsesEffort']
  /** @deprecated */
  thinkingOffEffortNone?: boolean
  /** @deprecated */
  thinkingOffReasoningEffortNone?: boolean
  thinkingEffort?: AIModel['thinkingEffort']
}

const THINKING_EFFORTS: NonNullable<AIModel['thinkingEffort']>[] = ['low', 'medium', 'high', 'max']

const normalizeOffResponsesEffort = (
  options?: ThinkingRuntimeOptions
): 'none' | 'minimal' => {
  if (options?.thinkingOffResponsesEffort === 'none' || options?.thinkingOffResponsesEffort === 'minimal') {
    return options.thinkingOffResponsesEffort
  }
  // 兼容旧布尔：勾选过则 minimal，否则仍默认 minimal
  return 'minimal'
}

export const normalizeThinkingOptions = (options?: ThinkingRuntimeOptions) => {
  const effort = options?.thinkingEffort
  return {
    enable: options?.enableThinking === true,
    offEnableThinkingFalse: options?.thinkingOffEnableThinkingFalse !== false,
    offThinkingTypeDisabled: options?.thinkingOffThinkingTypeDisabled === true,
    offResponsesEffort: normalizeOffResponsesEffort(options),
    effort: THINKING_EFFORTS.includes(effort as NonNullable<AIModel['thinkingEffort']>)
      ? effort!
      : 'medium'
  }
}

/**
 * 模型级参数约束表。
 *
 * 背景：各家厂商对同一批 OpenAI 兼容参数接受范围不同，且多为「传入非法值直接 400」而非忽略。
 * 已实测的两例：
 *   - GLM-5.3：reasoning_effort 仅 low/high/max，传 medium 报 invalid_parameter_error
 *   - Kimi K3 ：temperature 固定 1.0、top_p 固定 0.95（官方建议不要显式传入），传 0.7 报 400
 * 因此按 modelId 命中规则，在生成调用代码时裁剪/映射参数；未命中的模型一律保持原行为。
 *
 * 依据：
 *   https://docs.bigmodel.cn/cn/guide/capabilities/thinking （GLM-5.3/5.2 词表与映射）
 *   https://platform.kimi.com/docs/api/models-overview （K3/K2.7/K2.6 参数固定值表）
 */
export type ModelParamConstraints = {
  /** 请求体中不显式传 temperature（该模型固定取值，传其他值报错） */
  omitTemperature: boolean
  /** 请求体中不显式传 top_p */
  omitTopP: boolean
  /** 该模型不接受 reasoning_effort / reasoning 字段，完全不发 */
  dropReasoningEffort: boolean
  /** 关闭思考不被支持：不发任何「关闭」参数，交由模型默认行为 */
  forbidDisableThinking: boolean
  /** 接受的思考强度词表；null 表示不干预 */
  effortVocab: ThinkingEffortValue[] | null
}

type ThinkingEffortValue = NonNullable<AIModel['thinkingEffort']>

const DEFAULT_MODEL_PARAM_CONSTRAINTS: ModelParamConstraints = {
  omitTemperature: false,
  omitTopP: false,
  dropReasoningEffort: false,
  forbidDisableThinking: false,
  effortVocab: null
}

// 智谱 GLM-5.3 系与 Kimi K3 系恰好共用同一套三档词表
const THREE_TIER_EFFORT_VOCAB: ThinkingEffortValue[] = ['low', 'high', 'max']

const MODEL_PARAM_RULES: Array<{ test: RegExp; constraints: Partial<ModelParamConstraints> }> = [
  // Kimi K3 / K3.1 Pro（含 highspeed）：temperature 固定 1.0、top_p 固定 0.95；始终思考；effort 三档
  {
    test: /^kimi[-_]?k3(\.1)?(-pro)?(-highspeed)?$/i,
    constraints: {
      omitTemperature: true,
      omitTopP: true,
      forbidDisableThinking: true,
      effortVocab: THREE_TIER_EFFORT_VOCAB
    }
  },
  // Kimi K2.7 Code：temperature/top_p 固定，且不支持 reasoning_effort（始终思考，不可关闭）
  {
    test: /^kimi[-_]?k2\.?7(-code)?(-highspeed)?$/i,
    constraints: {
      omitTemperature: true,
      omitTopP: true,
      dropReasoningEffort: true,
      forbidDisableThinking: true
    }
  },
  // Kimi K2.6：top_p 固定 0.95；temperature 随思考开关变化（1.0/0.6）故一律不显式传；不支持 reasoning_effort
  {
    test: /^kimi[-_]?k2\.?6(-highspeed)?$/i,
    constraints: {
      omitTemperature: true,
      omitTopP: true,
      dropReasoningEffort: true
    }
  },
  // GLM-5.3 / Flash / FlashX：effort 仅 low/high/max，且不再支持关闭思考
  {
    test: /^glm[-_]?5\.3(-flashx?|-flash)?$/i,
    constraints: {
      forbidDisableThinking: true,
      effortVocab: THREE_TIER_EFFORT_VOCAB
    }
  }
  // GLM-5.2 未列入：它接受 low/medium/high/max（本项目词表），medium 合法，无需干预
]

export const resolveModelParamConstraints = (modelId?: string | null): ModelParamConstraints => {
  const raw = String(modelId || '').trim().toLowerCase()
  if (!raw) return { ...DEFAULT_MODEL_PARAM_CONSTRAINTS }

  // 兼容带路由前缀/后缀的写法：moonshot/kimi-k3、kimi-k3:free、Pro/zai-org/GLM-5
  const candidates = [raw, raw.split('/').pop() || raw]
    .map(item => item.replace(/:[a-z0-9_-]+$/i, ''))

  for (const rule of MODEL_PARAM_RULES) {
    if (candidates.some(id => rule.test.test(id))) {
      return { ...DEFAULT_MODEL_PARAM_CONSTRAINTS, ...rule.constraints }
    }
  }

  return { ...DEFAULT_MODEL_PARAM_CONSTRAINTS }
}

/**
 * 把用户选择的思考强度映射进该模型的合法词表。
 * 映射语义沿用智谱官方对 GLM-5.2 的定义：medium→high、minimal/none→low、xhigh→max。
 */
export const mapEffortToVocab = (
  effort: ThinkingEffortValue,
  vocab: ThinkingEffortValue[] | null
): ThinkingEffortValue => {
  if (!vocab || !vocab.length) return effort
  if (vocab.includes(effort)) return effort

  const fallbackMap: Record<string, ThinkingEffortValue> = {
    medium: 'high',
    minimal: 'low',
    none: 'low',
    xhigh: 'max'
  }
  const mapped = fallbackMap[effort]
  if (mapped && vocab.includes(mapped)) return mapped

  // 词表里没有可用映射时取官方默认档，避免发出必然报错的值
  const preferred: ThinkingEffortValue[] = ['max', 'high', 'medium', 'low']
  for (const candidate of preferred) {
    if (vocab.includes(candidate)) return candidate
  }
  return effort
}

const buildCommonHelpers = () => `
  const PRESET_MODEL_ID = __MODEL_ID__;
  const THINKING = __THINKING__;
  const PARAMS = __PARAMS__;
  const ENABLE_THINKING = !!(THINKING && THINKING.enable);

  const pickFirstString = (...values) => {
    for (const value of values) {
      if (typeof value === 'string' && value.length > 0) return value;
    }
    return '';
  };

  const normalizeBaseUrl = (baseUrl) => String(baseUrl || '').replace(/\\/+$/, '');

  // baseUrl 已带版本段（/v1、/v1beta 等）时直接拼端点路径，否则补 /v1 前缀（兼容两种 Base URL 写法）
  const buildApiUrl = (baseUrl, path) => {
    const base = normalizeBaseUrl(baseUrl);
    return /\\/v\\d+[a-z]*$/i.test(base) ? base + path : base + '/v1' + path;
  };

  // Chat：关 → enable_thinking / thinking.type；开 → reasoning_effort
  // Responses：关 → reasoning.effort none|minimal；开 → reasoning.effort
  // PARAMS 由构建期按 modelId 命中厂商约束表得出：omitTemperature/omitTopP/dropReasoningEffort/
  // forbidDisableThinking 为开关，effort 已映射进该模型合法词表
  // apiKind: 'chat' | 'responses'
  const applyOpenAIThinkingPayload = (payload, apiKind) => {
    const kind = apiKind === 'responses' ? 'responses' : 'chat';
    const effort = (THINKING && THINKING.effort) || 'medium';
    const dropEffort = !!(PARAMS && PARAMS.dropReasoningEffort);
    const forbidDisable = !!(PARAMS && PARAMS.forbidDisableThinking);

    if (kind === 'responses') {
      if (dropEffort) return;
      if (ENABLE_THINKING) {
        payload.reasoning = { effort: (PARAMS && PARAMS.effort) || effort };
      } else if (forbidDisable) {
        // 该模型不支持关闭思考：不发 reasoning，交由模型默认行为
      } else {
        const offEffort = (THINKING && THINKING.offResponsesEffort) || 'minimal';
        payload.reasoning = { effort: offEffort };
      }
      return;
    }

    // chat
    if (ENABLE_THINKING) {
      if (!dropEffort) payload.reasoning_effort = (PARAMS && PARAMS.effort) || effort;
      return;
    }
    if (forbidDisable) return;
    if (!THINKING || THINKING.offEnableThinkingFalse !== false) {
      payload.enable_thinking = false;
    }
    if (THINKING && THINKING.offThinkingTypeDisabled) {
      payload.thinking = { type: 'disabled' };
    }
  };

  // 采样参数：命中约束表的模型不显式传 temperature / top_p（官方为固定值，传其他值直接 400）
  const applySamplingParams = (payload) => {
    const omitTemp = !!(PARAMS && PARAMS.omitTemperature);
    const omitTopP = !!(PARAMS && PARAMS.omitTopP);

    if (!omitTemp && typeof config.temperature === 'number') payload.temperature = config.temperature;
    if (!omitTopP && typeof config.topP === 'number') payload.top_p = config.topP;
    if (typeof config.maxTokens === 'number') payload.max_tokens = config.maxTokens;
  };

  const getRuntimeModelId = () => PRESET_MODEL_ID || config.modelId || input.model || config.model || '';

  const buildHeaders = (extraHeaders = {}) => {
    const headers = {
      'Content-Type': 'application/json',
      ...extraHeaders
    };

    if (config.apiKey) {
      headers.Authorization = 'Bearer ' + config.apiKey;
    }

    if (config.customHeaders && typeof config.customHeaders === 'object') {
      Object.assign(headers, config.customHeaders);
    }

    return headers;
  };

  const ensureOk = async (response) => {
    if (response.ok) return;
    let message = '';
    try {
      message = await response.text();
    } catch {}
    const status = response.status || 0;
    const statusText = response.statusText || '';
    const body = (message || '').trim();
    let detail = body;
    try {
      const parsed = JSON.parse(body);
      detail = parsed.error?.message || parsed.message || parsed.error || body;
      if (detail && typeof detail !== 'string') detail = JSON.stringify(detail);
    } catch {}
    throw new Error(
      'HTTP ' + status + (statusText ? ' ' + statusText : '') + (detail ? ': ' + detail : '')
    );
  };

  const parseJsonSafe = async (response) => {
    const text = await response.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new Error(text || '响应不是合法 JSON');
    }
  };

  const readSSEPayloads = async function* (response) {
    const reader = response.body && response.body.getReader ? response.body.getReader() : null;
    if (!reader) return;

    const decoder = new TextDecoder();
    let buffer = '';

    const flush = async function* (chunkText) {
      const blocks = chunkText.split(/\\n\\n+/);
      buffer = blocks.pop() || '';

      for (const block of blocks) {
        const lines = block
          .split(/\\r?\\n/)
          .map((line) => line.trim())
          .filter(Boolean);

        const dataLines = lines
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim());

        if (!dataLines.length) continue;

        const data = dataLines.join('\\n');
        if (!data || data === '[DONE]') continue;

        try {
          yield JSON.parse(data);
        } catch {}
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      yield* flush(buffer);

      if (done) {
        if (buffer.trim()) {
          yield* flush(buffer + '\\n\\n');
        }
        break;
      }
    }
  };

  const joinTextParts = (value) => {
    if (typeof value === 'string') return value;
    if (!Array.isArray(value)) return '';
    return value.map((item) => {
      if (typeof item === 'string') return item;
      if (!item || typeof item !== 'object') return '';
      if (item.type === 'text' && typeof item.text === 'string') return item.text;
      if (item.type === 'output_text' && typeof item.text === 'string') return item.text;
      if (typeof item.content === 'string') return item.content;
      return '';
    }).join('');
  };

  const mapResponseTool = (tool) => {
    if (!tool || tool.type !== 'function' || !tool.function) return null;
    return {
      type: 'function',
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters || {
        type: 'object',
        properties: {}
      }
    };
  };

  const mapAnthropicTool = (tool) => {
    if (!tool || tool.type !== 'function' || !tool.function) return null;
    return {
      name: tool.function.name,
      description: tool.function.description,
      input_schema: tool.function.parameters || {
        type: 'object',
        properties: {}
      }
    };
  };

  const normalizeOpenAIChunk = (payload) => {
    const choice = payload && payload.choices ? payload.choices[0] || {} : {};
    const delta = choice.delta || {};
    const message = choice.message || {};
    const content = joinTextParts(delta.content ?? message.content ?? payload.content ?? payload.response);
    const reasoning = pickFirstString(
      delta.reasoning_content,
      delta.reasoning,
      message.reasoning_content,
      message.reasoning,
      payload.reasoning_content,
      payload.reasoning
    );
    const toolCalls = delta.tool_calls || message.tool_calls || payload.tool_calls;

    if (!content && !reasoning && (!toolCalls || !toolCalls.length) && !payload.usage) {
      return null;
    }

    return {
      ...payload,
      content,
      reasoning_content: reasoning,
      ...(toolCalls ? { tool_calls: toolCalls } : {})
    };
  };

  const mapResponsesContent = (content) => {
    if (typeof content === 'string') {
      return [{ type: 'input_text', text: content }];
    }

    if (!Array.isArray(content)) return [];

    return content
      .map((item) => {
        if (!item || typeof item !== 'object') return null;

        if (item.type === 'text' && typeof item.text === 'string') {
          return { type: 'input_text', text: item.text };
        }

        const imageUrl = item.image_url && typeof item.image_url.url === 'string' ? item.image_url.url : '';
        if (item.type === 'image_url' && imageUrl) {
          return { type: 'input_image', image_url: imageUrl, detail: item.image_url.detail || 'auto' };
        }

        return null;
      })
      .filter(Boolean);
  };

  const buildResponsesInput = (messages) => {
    return (messages || []).map((message) => ({
      role: message.role === 'system' ? 'system' : message.role,
      content: mapResponsesContent(message.content)
    }));
  };

  const extractResponsesText = (payload) => {
    if (typeof payload.output_text === 'string' && payload.output_text) return payload.output_text;

    const outputs = Array.isArray(payload.output) ? payload.output : Array.isArray(payload.response && payload.response.output) ? payload.response.output : [];
    return outputs
      .map((item) => {
        if (!item || typeof item !== 'object') return '';
        if (Array.isArray(item.content)) {
          return item.content
            .map((part) => {
              if (!part || typeof part !== 'object') return '';
              if (typeof part.text === 'string') return part.text;
              if (typeof part.content === 'string') return part.content;
              return '';
            })
            .join('');
        }
        return typeof item.text === 'string' ? item.text : '';
      })
      .join('');
  };

  const normalizeResponsesPayload = (payload) => {
    const content = extractResponsesText(payload);
    const reasoning = pickFirstString(
      payload.reasoning_content,
      payload.reasoning,
      payload.response && payload.response.reasoning_content,
      payload.response && payload.response.reasoning
    );

    const outputs = Array.isArray(payload.output) ? payload.output : Array.isArray(payload.response && payload.response.output) ? payload.response.output : [];
    const toolCalls = outputs
      .filter((item) => item && item.type === 'function_call')
      .map((item) => ({
        id: item.call_id || item.id || 'function_call',
        function: {
          name: item.name || '',
          arguments: typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments || {})
        }
      }));

    if (!content && !reasoning && !toolCalls.length && !payload.usage) {
      return null;
    }

    return {
      ...payload,
      content,
      reasoning_content: reasoning,
      ...(toolCalls.length ? { tool_calls: toolCalls } : {})
    };
  };

  const mapAnthropicContent = (content) => {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return [];

    return content
      .map((item) => {
        if (!item || typeof item !== 'object') return null;

        if (item.type === 'text' && typeof item.text === 'string') {
          return { type: 'text', text: item.text };
        }

        const imageUrl = item.image_url && typeof item.image_url.url === 'string' ? item.image_url.url : '';
        if (item.type === 'image_url' && imageUrl.startsWith('data:')) {
          const match = imageUrl.match(/^data:(.+?);base64,(.+)$/);
          if (!match) return null;
          return {
            type: 'image',
            source: {
              type: 'base64',
              media_type: match[1],
              data: match[2]
            }
          };
        }

        return null;
      })
      .filter(Boolean);
  };

  const buildAnthropicMessages = (messages) => {
    const systemParts = [];
    const normalizedMessages = [];

    for (const message of messages || []) {
      if (message.role === 'system') {
        const systemText = typeof message.content === 'string' ? message.content : joinTextParts(message.content);
        if (systemText) systemParts.push(systemText);
        continue;
      }

      normalizedMessages.push({
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: mapAnthropicContent(message.content)
      });
    }

    return {
      system: systemParts.join('\\n\\n'),
      messages: normalizedMessages
    };
  };

  const normalizeAnthropicPayload = (payload) => {
    const contentBlocks = Array.isArray(payload.content) ? payload.content : [];
    const content = contentBlocks
      .filter((item) => item && item.type === 'text')
      .map((item) => item.text || '')
      .join('');
    const reasoning = contentBlocks
      .filter((item) => item && (item.type === 'thinking' || item.type === 'redacted_thinking'))
      .map((item) => item.thinking || item.text || '')
      .join('');
    const toolCalls = contentBlocks
      .filter((item) => item && item.type === 'tool_use')
      .map((item) => ({
        id: item.id || 'tool_use',
        function: {
          name: item.name || '',
          arguments: JSON.stringify(item.input || {})
        }
      }));

    if (!content && !reasoning && !toolCalls.length && !payload.usage) {
      return null;
    }

    return {
      ...payload,
      content,
      reasoning_content: reasoning,
      ...(toolCalls.length ? { tool_calls: toolCalls } : {})
    };
  };
`

const injectTemplateHelpers = (modelId: string, thinking: ReturnType<typeof normalizeThinkingOptions>) => {
  // 构建期解析厂商约束：modelId 在此已知，无需把词表逻辑塞进生成的运行时代码
  const constraints = resolveModelParamConstraints(modelId)
  const params = {
    ...constraints,
    effort: mapEffortToVocab(thinking.effort, constraints.effortVocab)
  }

  return buildCommonHelpers()
    .replace('__MODEL_ID__', JSON.stringify(modelId))
    .replace('__THINKING__', JSON.stringify(thinking))
    .replace('__PARAMS__', JSON.stringify(params))
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n')
}

const buildOpenAIChatTemplate = (modelId: string, thinking: ReturnType<typeof normalizeThinkingOptions>) => `
async function processModel(input, config, fetch, abortSignal) {
${injectTemplateHelpers(modelId, thinking)}

  const runtimeModelId = getRuntimeModelId();
  const payload = {
    model: runtimeModelId,
    messages: input.messages || [],
    stream: input.stream !== false
  };

  if (input.tools && input.tools.length) {
    payload.tools = input.tools;
  }
  applySamplingParams(payload);
  applyOpenAIThinkingPayload(payload, 'chat');

  const response = await fetch(buildApiUrl(config.baseUrl, '/chat/completions'), {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify(payload),
    signal: abortSignal
  });

  await ensureOk(response);

  if (payload.stream && response.body) {
    return (async function* () {
      for await (const event of readSSEPayloads(response)) {
        const chunk = normalizeOpenAIChunk(event);
        if (chunk) yield chunk;
      }
    })();
  }

  return normalizeOpenAIChunk(await parseJsonSafe(response)) || {};
}
`.trim()

const buildOpenAIResponsesTemplate = (modelId: string, thinking: ReturnType<typeof normalizeThinkingOptions>) => `
async function processModel(input, config, fetch, abortSignal) {
${injectTemplateHelpers(modelId, thinking)}

  const runtimeModelId = getRuntimeModelId();
  const payload = {
    model: runtimeModelId,
    input: buildResponsesInput(input.messages || []),
    stream: input.stream !== false
  };

  if (input.tools && input.tools.length) {
    payload.tools = input.tools.map(mapResponseTool).filter(Boolean);
  }
  applyOpenAIThinkingPayload(payload, 'responses');

  const response = await fetch(buildApiUrl(config.baseUrl, '/responses'), {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify(payload),
    signal: abortSignal
  });

  await ensureOk(response);

  if (payload.stream && response.body) {
    return (async function* () {
      const toolCallState = new Map();

      for await (const event of readSSEPayloads(response)) {
        const eventType = event && event.type ? event.type : '';

        if (eventType === 'response.output_text.delta' && typeof event.delta === 'string') {
          yield { ...event, content: event.delta };
          continue;
        }

        if (eventType.includes('reasoning') && typeof event.delta === 'string') {
          yield { ...event, reasoning_content: event.delta };
          continue;
        }

        if (eventType === 'response.output_item.added' && event.item && event.item.type === 'function_call') {
          const state = {
            id: event.item.call_id || event.item.id || 'function_call',
            name: event.item.name || ''
          };
          toolCallState.set(event.item.id || state.id, state);
          yield {
            ...event,
            tool_calls: [
              {
                id: state.id,
                function: {
                  name: state.name,
                  arguments: ''
                }
              }
            ]
          };
          continue;
        }

        if (eventType === 'response.function_call_arguments.delta' && typeof event.delta === 'string') {
          const state = toolCallState.get(event.item_id) || {
            id: event.call_id || event.item_id || 'function_call',
            name: ''
          };
          yield {
            ...event,
            tool_calls: [
              {
                id: state.id,
                function: {
                  name: state.name,
                  arguments: event.delta
                }
              }
            ]
          };
          continue;
        }

        if (event.usage) {
          yield event;
        }
      }
    })();
  }

  return normalizeResponsesPayload(await parseJsonSafe(response)) || {};
}
`.trim()

const buildAnthropicTemplate = (modelId: string, thinking: ReturnType<typeof normalizeThinkingOptions>) => `
async function processModel(input, config, fetch, abortSignal) {
${injectTemplateHelpers(modelId, thinking)}

  const runtimeModelId = getRuntimeModelId();
  const prepared = buildAnthropicMessages(input.messages || []);
  const payload = {
    model: runtimeModelId,
    max_tokens: typeof config.maxTokens === 'number' ? config.maxTokens : 4096,
    messages: prepared.messages,
    stream: input.stream !== false
  };

  if (prepared.system) {
    payload.system = prepared.system;
  }

  if (input.tools && input.tools.length) {
    payload.tools = input.tools.map(mapAnthropicTool).filter(Boolean);
  }
  if (ENABLE_THINKING) {
    if (!PARAMS || !PARAMS.dropReasoningEffort) {
      payload.reasoning = { effort: (PARAMS && PARAMS.effort) || (THINKING && THINKING.effort) || 'medium' };
    }
  } else if (!PARAMS || !PARAMS.forbidDisableThinking) {
    payload.thinking = { type: 'disabled' };
  }

  const response = await fetch(buildApiUrl(config.baseUrl, '/messages'), {
    method: 'POST',
    headers: buildHeaders({
      'anthropic-version': '2023-06-01'
    }),
    body: JSON.stringify(payload),
    signal: abortSignal
  });

  await ensureOk(response);

  if (payload.stream && response.body) {
    return (async function* () {
      const blockState = new Map();

      for await (const event of readSSEPayloads(response)) {
        if (event.type === 'content_block_start' && event.content_block) {
          blockState.set(event.index, event.content_block);

          if (event.content_block.type === 'tool_use') {
            yield {
              ...event,
              tool_calls: [
                {
                  id: event.content_block.id || 'tool_use',
                  function: {
                    name: event.content_block.name || '',
                    arguments: event.content_block.input ? JSON.stringify(event.content_block.input) : ''
                  }
                }
              ]
            };
          }
          continue;
        }

        if (event.type === 'content_block_delta' && event.delta) {
          if (event.delta.type === 'text_delta' && typeof event.delta.text === 'string') {
            yield { ...event, content: event.delta.text };
            continue;
          }

          if (event.delta.type === 'thinking_delta' && typeof event.delta.thinking === 'string') {
            yield { ...event, reasoning_content: event.delta.thinking };
            continue;
          }

          if (event.delta.type === 'input_json_delta' && typeof event.delta.partial_json === 'string') {
            const block = blockState.get(event.index) || {};
            yield {
              ...event,
              tool_calls: [
                {
                  id: block.id || 'tool_use',
                  function: {
                    name: block.name || '',
                    arguments: event.delta.partial_json
                  }
                }
              ]
            };
            continue;
          }
        }

        if (event.usage) {
          yield event;
        }
      }
    })();
  }

  return normalizeAnthropicPayload(await parseJsonSafe(response)) || {};
}
`.trim()

export const buildPresetProcessModelJsCode = (options: {
  protocol?: ApiProtocol
  modelId?: string
} & ThinkingRuntimeOptions): string => {
  const protocol = normalizeApiProtocol(options.protocol)
  const modelId = options.modelId?.trim() || ''
  const thinking = normalizeThinkingOptions(options)

  switch (protocol) {
    case 'openai-response':
      return buildOpenAIResponsesTemplate(modelId, thinking)
    case 'anthropic':
      return buildAnthropicTemplate(modelId, thinking)
    case 'custom':
    case 'openai-chat':
    default:
      return buildOpenAIChatTemplate(modelId, thinking)
  }
}

export const resolveExecutableModelJsCode = (
  model?: Partial<Pick<AIModel,
    'apiProtocol' | 'jsCode' | 'modelId' | 'id' | 'enableThinking' |
    'thinkingOffEnableThinkingFalse' | 'thinkingOffThinkingTypeDisabled' |
    'thinkingOffResponsesEffort' | 'thinkingOffEffortNone' |
    'thinkingOffReasoningEffortNone' | 'thinkingEffort'
  >>
): string => {
  if (!model) return ''

  const protocol = normalizeApiProtocol(model.apiProtocol)
  if (protocol === 'custom') {
    return model.jsCode?.trim() || ''
  }

  return buildPresetProcessModelJsCode({
    protocol,
    modelId: resolveRuntimeModelId(model),
    enableThinking: model.enableThinking === true,
    thinkingOffEnableThinkingFalse: model.thinkingOffEnableThinkingFalse,
    thinkingOffThinkingTypeDisabled: model.thinkingOffThinkingTypeDisabled,
    thinkingOffResponsesEffort: model.thinkingOffResponsesEffort,
    thinkingOffEffortNone: model.thinkingOffEffortNone,
    thinkingOffReasoningEffortNone: model.thinkingOffReasoningEffortNone,
    thinkingEffort: model.thinkingEffort
  })
}
