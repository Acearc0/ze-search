/** 「从供应商 API 拉取模型」的编排：拉取 → diff → 应用到平台配置。 */
import { computed, ref, type Ref } from 'vue'
import type { AIModel, AIPlatform } from '../../../services/model/config'
import { modelConfigManager } from '../../../services/model/config'
import {
  fetchBailianModels,
  diffFetchedModels,
  type FetchedModel
} from '../../../services/model/fetchModels'

export function useFetchModels(selectedPlatform: Ref<AIPlatform | null>) {
  const dialogVisible = ref(false)
  const fetching = ref(false)
  const fetchError = ref('')
  const fetchEndpoint = ref<'native' | 'compatible' | undefined>(undefined)
  const added = ref<FetchedModel[]>([])
  const expired = ref<string[]>([])

  /** 默认模型参数（与官方 addModel 的默认值保持一致；category 与 AIModel 同域） */
  const defaultModelConfig = (category: AIModel['category']): Omit<AIModel, 'id' | 'platformId'> => ({
    displayName: '',
    modelId: '',
    maxTokens: 4096,
    temperature: 0.7,
    topP: 1,
    enabled: true,
    category,
    apiProtocol: 'openai-chat'
  })

  const openFetchDialog = async () => {
    const platform = selectedPlatform.value
    if (!platform) return

    fetchError.value = ''
    fetchEndpoint.value = undefined
    added.value = []
    expired.value = []
    dialogVisible.value = true
    fetching.value = true

    try {
      const apiKey = modelConfigManager.getPlatformApiKey(platform)
      if (!apiKey) {
        fetchError.value = '请先填写该平台的 API Key。'
        return
      }

      const result = await fetchBailianModels(platform.baseUrl || '', apiKey)
      fetchEndpoint.value = result.endpoint
      if (!result.models.length) {
        fetchError.value = result.error
          ? `拉取失败：${result.error}`
          : '未拉取到可用模型（已排除生图、向量等非对话模型）。'
        return
      }

      const existing = (platform.models || []).map(m => m.modelId || m.displayName || m.id)
      const diff = diffFetchedModels(result.models, existing)
      added.value = diff.added
      // 只把"本平台管理的"模型视为可清理对象；远程同步模型（isRemote）永不建议删除
      expired.value = diff.expired.filter(id => {
        const m = (platform.models || []).find(x => (x.modelId || x.displayName || x.id) === id)
        return m && !m.isRemote
      })

      if (result.error) fetchError.value = `原生端点不可用，已用兼容接口回退：${result.error}`
    } finally {
      fetching.value = false
    }
  }

  const closeFetchDialog = () => {
    dialogVisible.value = false
  }

  /** 应用：勾选的新模型加入平台，勾选的失效模型删除 */
  const applyFetchResult = (enabledIds: string[], removedIds: string[]) => {
    const platform = selectedPlatform.value
    if (!platform) return

    for (const fetched of added.value) {
      if (!enabledIds.includes(fetched.id)) continue
      // 去重：兼容接口回退可能与已存在模型同 id
      if ((platform.models || []).some(m => (m.modelId || m.displayName) === fetched.id)) continue
      const model = defaultModelConfig(fetched.category)
      model.displayName = fetched.id
      model.modelId = fetched.id
      model.hasVision = fetched.category === 'vision'
      modelConfigManager.addModelToPlatform(platform.id, model)
    }

    for (const id of removedIds) {
      const existing = (platform.models || []).find(m => (m.modelId || m.displayName || m.id) === id)
      if (existing && !existing.isRemote) modelConfigManager.removeModel(existing.id)
    }

    dialogVisible.value = false
  }

  const canFetch = computed(() => !!selectedPlatform.value && !fetching.value)

  return {
    dialogVisible, fetching, fetchError, fetchEndpoint,
    added, expired, canFetch,
    openFetchDialog, closeFetchDialog, applyFetchResult
  }
}
