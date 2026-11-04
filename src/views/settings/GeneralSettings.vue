<template>
  <div class="general-settings">
    <div class="network-group">
      <div class="group-title">显示设置</div>
    <div class="setting-item">
      <div class="setting-info">
        <h3 class="setting-title">主题模式</h3>
        <p class="setting-description">选择您偏好的界面主题</p>
      </div>
      <div class="setting-control">
        <ThemeSwitch v-model="localSettings.theme" @update:modelValue="handleThemeChange" />
      </div>
    </div>
    </div>

    <div class="network-group">
      <div class="group-title">保存设置</div>
    <div class="setting-item">
      <div class="setting-info">
        <h3 class="setting-title">缓存文件夹</h3>
        <p class="setting-description">打开应用缓存目录，可手动清理缓存文件</p>
      </div>
      <div class="setting-control">
        <button 
          ref="btnRef"
          class="folder-action-btn select-folder-btn"
          :class="{ 'btn-ripple': isAnimating }"
          @click="handleButtonClick"
        >
          <svg t="1774430153065" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="16" height="16">
            <path d="M418.688 133.333333a122.666667 122.666667 0 0 1 93.013333 42.666667H785.066667a186.666667 186.666667 0 0 1 186.581333 181.162667l0.085333 5.504v17.92h-0.256c0.170667 1.429333 0.256 2.88 0.256 4.373333V789.333333a186.666667 186.666667 0 0 1-186.666666 186.666667H238.933333A186.666667 186.666667 0 0 1 52.266667 789.333333V320a186.666667 186.666667 0 0 1 186.666666-186.666667z m0 74.666667H238.933333A112 112 0 0 0 126.933333 320v469.333333c0 61.866667 50.133333 112 112 112h546.133334c61.866667 0 112-50.133333 112-112V422.272H615.04a122.666667 122.666667 0 0 1-113.834667-76.992l-1.834666-4.842667-35.413334-100.416a48 48 0 0 0-45.269333-32.021333zM448 688a37.333333 37.333333 0 0 1 3.072 74.538667L448 762.666667h-170.666667a37.333333 37.333333 0 0 1-3.072-74.538667L277.333333 688h170.666667z m337.066667-437.333333H546.88l22.912 64.917333a48 48 0 0 0 41.685333 31.914667l3.562667 0.128 281.024-0.021334a112.021333 112.021333 0 0 0-106.389333-96.853333l-4.608-0.085333z" fill="currentColor"/>
          </svg>
          打开文件夹
        </button>
      </div>
    </div>

    <div class="setting-item">
      <div class="setting-info">
        <h3 class="setting-title">题目保存文件夹</h3>
        <p class="setting-description">
          AI返回答案的题目将保存至：
          <button
            v-if="settings.questionSaveDir"
            type="button"
            class="selected-folder-link"
            :disabled="!canOpenQuestionSaveFolder"
            @click="openQuestionSaveFolder"
          >
            {{ settings.questionSaveDir }}
          </button>
          <span v-else class="unset-hint">默认文件夹</span>
        </p>

      </div>
      <div class="setting-control">
        <button class="folder-action-btn select-folder-btn" @click="selectQuestionSaveDir">
          <svg t="1774430153065" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="16" height="16">
            <path d="M418.688 133.333333a122.666667 122.666667 0 0 1 93.013333 42.666667H785.066667a186.666667 186.666667 0 0 1 186.581333 181.162667l0.085333 5.504v17.92h-0.256c0.170667 1.429333 0.256 2.88 0.256 4.373333V789.333333a186.666667 186.666667 0 0 1-186.666666 186.666667H238.933333A186.666667 186.666667 0 0 1 52.266667 789.333333V320a186.666667 186.666667 0 0 1 186.666666-186.666667z m0 74.666667H238.933333A112 112 0 0 0 126.933333 320v469.333333c0 61.866667 50.133333 112 112 112h546.133334c61.866667 0 112-50.133333 112-112V422.272H615.04a122.666667 122.666667 0 0 1-113.834667-76.992l-1.834666-4.842667-35.413334-100.416a48 48 0 0 0-45.269333-32.021333zM448 688a37.333333 37.333333 0 0 1 3.072 74.538667L448 762.666667h-170.666667a37.333333 37.333333 0 0 1-3.072-74.538667L277.333333 688h170.666667z m337.066667-437.333333H546.88l22.912 64.917333a48 48 0 0 0 41.685333 31.914667l3.562667 0.128 281.024-0.021334a112.021333 112.021333 0 0 0-106.389333-96.853333l-4.608-0.085333z" fill="currentColor"/>
          </svg>
          选择文件夹
        </button>
      </div>
    </div>

    <div class="setting-item">
      <div class="setting-info">
        <h3 class="setting-title">AI回答添加到本地题库</h3>
        <p class="setting-description">开启后，AI 新答出的题目会写入本地题库；关闭则只返回答案，不入库。</p>
      </div>
      <div class="setting-control">
        <Toggle v-model="settings.autoAddToQuestionBank" variant="default" size="medium"
          @change="handleSettingChange('autoAddToQuestionBank', $event)" />
      </div>
    </div>
    </div>

    <div class="network-group">
      <div class="group-title">AI设置</div>
    <div class="setting-item">

      <div class="setting-info">
        <h3 class="setting-title">模型最长响应时间</h3>
        <p class="setting-description">AI 模型单次请求超时（秒）。超时后中止该次调用并可按「失败自动重试次数」重试；整题最长等待 ≈ 本值 × (1+重试) + 缓冲。默认 40 秒。</p>
      </div>
      <div class="setting-control timeout-control">
        <input
          type="number"
          class="form-input"
          :value="settings.modelResponseTimeout ?? 40"
          min="5"
          max="600"
          step="5"
          @change="handleSettingChange('modelResponseTimeout', Number(($event.target as HTMLInputElement).value))"
        />
        <span class="timeout-unit">秒</span>
      </div>
    </div>
    <div class="setting-item">
      <div class="setting-info">
        <h3 class="setting-title">失败自动重试次数</h3>
        <p class="setting-description">仅在「只有一个基础模型」、总结模型失败、或视觉模型调用失败时自动重试。0 表示不重试，默认 2 次。</p>
      </div>
      <div class="setting-control timeout-control">
        <input
          type="number"
          class="form-input"
          :value="settings.modelRetryCount ?? 2"
          min="0"
          max="10"
          step="1"
          @change="handleSettingChange('modelRetryCount', Math.max(0, Math.min(10, Number(($event.target as HTMLInputElement).value) || 0)))"
        />
        <span class="timeout-unit">次</span>
      </div>
    </div>
    </div>

    <div class="network-group">
      <div class="group-title">多模型答题</div>
    <div class="setting-item">
      <div class="setting-info">
        <h3 class="setting-title">启用懒投票</h3>
        <p class="setting-description">开启时先并发调用前两个模型，答案一致则直接采用并跳过其余模型，不一致（或任一失败）才继续调用；关闭时所有已选模型并发调用。默认开启。</p>
      </div>
      <div class="setting-control">
        <Toggle v-model="settings.answerLazyVote" variant="default" size="medium"
          @change="handleSettingChange('answerLazyVote', $event)" />
      </div>
    </div>
    <div class="setting-item">
      <div class="setting-info">
        <h3 class="setting-title">第三模型（仲裁模型）</h3>
        <p class="setting-description">懒投票下前两个模型答案不一致时，仅调用该模型参与投票取多数票；不指定则调用其余已选模型共同投票。与已选文本模型重复时自动忽略。</p>
      </div>
      <div class="setting-control">
        <select class="form-input" :value="settings.arbitrationModelId ?? ''"
          @change="handleSettingChange('arbitrationModelId', ($event.target as HTMLSelectElement).value || null)">
          <option value="">不指定（其余已选模型共同投票）</option>
          <option v-for="m in arbitrationCandidates" :key="m.id" :value="m.id">{{ m.displayName }}</option>
        </select>
      </div>
    </div>
    </div>

    <div class="network-group">
      <div class="group-title">联网搜索</div>
    <div class="setting-item">
      <div class="setting-info">
        <h3 class="setting-title">启用联网搜索</h3>
        <p class="setting-description">开启后，模型可在不确定答案时调用 web_search 工具联网查证（免费引擎，无需 API Key）。关闭时不产生任何额外网络请求。</p>
      </div>
      <div class="setting-control">
        <Toggle v-model="settings.webSearch.enabled" variant="default" size="medium"
          @change="updateWebSearch({ enabled: $event })" />
      </div>
    </div>
    <div class="setting-item">
      <div class="setting-info">
        <h3 class="setting-title">搜索引擎</h3>
        <p class="setting-description">首选引擎；失败时自动回退到其他免费引擎。</p>
      </div>
      <div class="setting-control">
        <select class="form-input" :value="settings.webSearch.engine"
          @change="updateWebSearch({ engine: ($event.target as HTMLSelectElement).value as WebSearchEngine })">
          <option value="bing">Bing（推荐，最稳定）</option>
          <option value="ddg">DuckDuckGo HTML</option>
          <option value="ddg-lite">DuckDuckGo Lite</option>
          <option value="searxng">SearXNG 元搜索</option>
          <option value="anysearch">AnySearch</option>
          <option value="tavily">Tavily</option>
        </select>
      </div>
    </div>
    <div class="setting-item">
      <div class="setting-info">
        <h3 class="setting-title">Tavily API Key</h3>
        <p class="setting-description">仅选择 Tavily 引擎时需要；留空走 Tavily 匿名额度。Key 仅保存在本地配置。</p>
      </div>
      <div class="setting-control">
        <input type="password" class="form-input" :value="settings.webSearch.apiKey"
          @change="updateWebSearch({ apiKey: ($event.target as HTMLInputElement).value })" placeholder="tvly-...（可选）" />
      </div>
    </div>
    <div class="setting-item">
      <div class="setting-info">
        <h3 class="setting-title">最大结果数</h3>
        <p class="setting-description">每次搜索返回给模型的来源条数上限。</p>
      </div>
      <div class="setting-control timeout-control">
        <input type="number" class="form-input" :value="settings.webSearch.maxResults" min="1" max="10" step="1"
          @change="updateWebSearch({ maxResults: Math.max(1, Math.min(10, Number(($event.target as HTMLInputElement).value) || 5)) })" />
        <span class="timeout-unit">条</span>
      </div>
    </div>
    <div class="setting-item">
      <div class="setting-info">
        <h3 class="setting-title">搜索超时</h3>
        <p class="setting-description">单次搜索请求的超时时间（秒）。</p>
      </div>
      <div class="setting-control timeout-control">
        <input type="number" class="form-input" :value="settings.webSearch.timeoutSeconds" min="3" max="60" step="1"
          @change="updateWebSearch({ timeoutSeconds: Math.max(3, Math.min(60, Number(($event.target as HTMLInputElement).value) || 12)) })" />
        <span class="timeout-unit">秒</span>
      </div>
    </div>
    <div class="setting-item">
      <div class="setting-info">
        <h3 class="setting-title">SearXNG 实例列表</h3>
        <p class="setting-description">可选，自建/信任的 SearXNG 实例 URL（逗号分隔）；留空使用内置公网实例池。</p>
      </div>
      <div class="setting-control">
        <input type="text" class="form-input" :value="settings.webSearch.searxngInstances"
          @change="updateWebSearch({ searxngInstances: ($event.target as HTMLInputElement).value })" placeholder="https://searx.example.com" />
      </div>
    </div>
    <div class="setting-item">
      <div class="setting-info">
        <h3 class="setting-title">测试联网搜索</h3>
        <p class="setting-description">
          使用当前配置发起一次测试搜索，验证引擎可用性。
          <span v-if="webSearchTestText" :style="{ color: webSearchTestOk === null ? 'inherit' : (webSearchTestOk ? '#16a34a' : '#dc2626') }">{{ webSearchTestText }}</span>
        </p>
      </div>
      <div class="setting-control">
        <button class="folder-action-btn select-folder-btn" :disabled="webSearchTesting" @click="testWebSearch">
          {{ webSearchTesting ? '测试中…' : '测试' }}
        </button>
      </div>
    </div>
    </div>

    <div class="network-group">
      <div class="group-title">网络设置</div>
    <div class="setting-item">
      <div class="setting-info">
        <h3 class="setting-title">服务器端口</h3>
        <p class="setting-description">设置本地服务器监听的端口号</p>
      </div>
      <div class="setting-control">
        <div class="input-group">
          <input
            type="number"
            v-model="settings.network.serverPort"
            @change="handleNetworkChange"
            min="1"
            max="65535"
            class="form-input"
            placeholder="3000"
          />
          <span class="input-suffix">端口</span>
        </div>
      </div>
    </div>

    <div class="setting-item">
      <div class="setting-info">
        <div class="setting-title-with-help">
          <h3 class="setting-title">局域网访问</h3>
          <button class="help-button" @click="openLanAccessDocs" title="查看局域网访问文档">
            <svg width="14" height="14" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
              <path d="M463.99957 784.352211c0 26.509985 21.490445 48.00043 48.00043 48.00043s48.00043-21.490445 48.00043-48.00043c0-26.509985-21.490445-48.00043-48.00043-48.00043S463.99957 757.842226 463.99957 784.352211z" fill="currentColor"></path>
              <path d="M512 960c-247.039484 0-448-200.960516-448-448S264.960516 64 512 64 960 264.960516 960 512 759.039484 960 512 960zM512 128.287273c-211.584464 0-383.712727 172.128262-383.712727 383.712727 0 211.551781 172.128262 383.712727 383.712727 383.712727 211.551781 0 383.712727-172.159226 383.712727-383.712727C895.712727 300.415536 723.551781 128.287273 512 128.287273z" fill="currentColor"></path>
              <path d="M512 673.695256c-17.664722 0-32.00086-14.336138-32.00086-31.99914l0-54.112297c0-52.352533 39.999785-92.352318 75.32751-127.647359 25.887273-25.919957 52.67249-52.67249 52.67249-74.016718 0-53.343368-43.07206-96.735385-95.99914-96.735385-53.823303 0-95.99914 41.535923-95.99914 94.559333 0 17.664722-14.336138 31.99914-32.00086 31.99914s-32.00086-14.336138-32.00086-31.99914c0-87.423948 71.775299-158.559333 160.00086-158.559333s160.00086 72.095256 160.00086 160.735385c0 47.904099-36.32028 84.191695-71.424378 119.295794-27.839699 27.776052-56.575622 56.511974-56.575622 82.3356l0 54.112297C544.00086 659.328155 529.664722 673.695256 512 673.695256z" fill="currentColor"></path>
            </svg>
          </button>
        </div>
        <p class="setting-description">允许局域网内其他设备访问本地服务器</p>
      </div>
      <div class="setting-control">
        <Toggle
          v-model="settings.network.enableLanAccess"
          variant="default"
          size="medium"
          @change="handleNetworkChange"
        />
      </div>
    </div>

    <div class="setting-item">
      <div class="setting-info">
        <h3 class="setting-title">绑定地址</h3>
        <p class="setting-description">服务器绑定的IP地址（自动根据局域网访问设置调整）</p>
      </div>
      <div class="setting-control">
        <div class="readonly-value">
          {{ settings.network.bindAddress }}
        </div>
      </div>
    </div>
    </div>
  </div>

  <FolderPickerDialog
    :visible="showFolderPicker"
    :initial-folder-id="settings.questionSaveFolderId"
    @cancel="showFolderPicker = false"
    @confirm="handleFolderConfirm"
  />
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'

import { useSettingsManager } from '../../composables/useSettingsManager'
import { useModelConfig } from '../../services/modelConfig'

import { useTheme } from '../../composables/useTheme'
import { environmentDetector } from '../../services/environmentDetector'
import ThemeSwitch from './GeneralSettings/ThemeSwitch.vue'
import Toggle from '../../components/Toggle.vue'
import FolderPickerDialog from '../../components/FolderPickerDialog.vue'

const emit = defineEmits<{
  'open-question-folder': [folderId: number]
}>()

// 打开缓存文件夹
const openingCache = ref(false)

const isAnimating = ref(false)
const isCooldown = ref(false)

const btnRef = ref<HTMLElement | null>(null)
let animationTimer: any = null
const handleButtonClick = () => {
  // 1. 每次点击都会强制重新触发视觉动画
  if (animationTimer) clearTimeout(animationTimer)
  
  // 核心逻辑：先取消类名，强制重绘，再重新添加类名
  isAnimating.value = false
  
  if (btnRef.value) {
    // 强制引发重排 (Reflow)，确保浏览器感知到 class 的移除
    void btnRef.value.offsetWidth
  }
  
  // 使用 requestAnimationFrame 确保在下一次重绘时添加类名
  requestAnimationFrame(() => {
    isAnimating.value = true
    animationTimer = setTimeout(() => {
      isAnimating.value = false
      animationTimer = null
    }, 600)
  })

  // 2. 只有在冷却结束后才会再次触发实际逻辑
  if (isCooldown.value || openingCache.value) return
  
  isCooldown.value = true
  setTimeout(() => {
    isCooldown.value = false
  }, 5000)

  openCacheFolder()
}

// 打开处理函数
let invoke: any = null

const openCacheFolder = async () => {
  openingCache.value = true
  try {
    if (!invoke) {
      const core = await import('@tauri-apps/api/core')
      invoke = core.invoke
    }
    await invoke('open_cache_dir')
  } catch (e) {
    console.error('打开缓存文件夹失败:', e)
  } finally {
    openingCache.value = false
  }
}
// 设置管理
const { settings, saveSettings, setSetting } = useSettingsManager()

// 多模型答题：第三模型（仲裁模型）候选列表 = 所有已启用模型（不限分类）
const modelConfigStore = useModelConfig()
const arbitrationCandidates = computed(() =>
  (modelConfigStore.platforms?.value || []).flatMap(p => (p.models || []).filter(m => m.enabled))
)
const canOpenQuestionSaveFolder = computed(() => settings.value.questionSaveFolderId !== null && settings.value.questionSaveFolderId !== undefined)


const handleSettingChange = (key: keyof import('../../services/settings').AppSettings, value: any) => {
  setSetting(key, value)
}


const showFolderPicker = ref(false)

const selectQuestionSaveDir = () => {
  showFolderPicker.value = true
}

const openQuestionSaveFolder = () => {
  const folderId = settings.value.questionSaveFolderId
  if (folderId === null || folderId === undefined) return
  emit('open-question-folder', folderId)
}

const handleFolderConfirm = async (folderId: number, folderName: string, folderPath: string) => {

  showFolderPicker.value = false
  setSetting('questionSaveDir', folderPath || folderName)
  setSetting('questionSaveFolderId', folderId)
  await saveSettings()
}

const handleNetworkChange = () => {
  settings.value.network.bindAddress = settings.value.network.enableLanAccess ? '0.0.0.0' : '127.0.0.1'
}

// 联网搜索设置：嵌套对象合并后整体写回（与 network 的存储方式一致）
type WebSearchEngine = import('../../services/webSearch').SearchEngine
const updateWebSearch = (patch: Partial<import('../../services/webSearch').WebSearchSettings>) => {
  settings.value.webSearch = { ...settings.value.webSearch, ...patch }
  setSetting('webSearch', settings.value.webSearch)
}

// 联网搜索测试：用当前配置发起一次真实搜索并显示结果/耗时
const webSearchTesting = ref(false)
const webSearchTestText = ref('')
const webSearchTestOk = ref<boolean | null>(null)
const testWebSearch = async () => {
  webSearchTesting.value = true
  webSearchTestText.value = ''
  webSearchTestOk.value = null
  const startedAt = Date.now()
  try {
    const { webSearch } = await import('../../services/webSearch')
    const resp = await webSearch('OpenAI 最新模型', settings.value.webSearch)
    const ms = Date.now() - startedAt
    if (resp.sources.length > 0) {
      webSearchTestOk.value = true
      webSearchTestText.value = `✓ 引擎 ${resp.engine} 返回 ${resp.sources.length} 条结果，耗时 ${ms}ms${resp.fallbackNote ? `（${resp.fallbackNote}）` : ''}`
    } else {
      webSearchTestOk.value = false
      webSearchTestText.value = `✗ 引擎 ${resp.engine} 未返回任何结果`
    }
  } catch (e: any) {
    webSearchTestOk.value = false
    webSearchTestText.value = `✗ ${e?.message || String(e)}`
  } finally {
    webSearchTesting.value = false
  }
}

const openLanAccessDocs = async () => {
  const url = 'https://docs.zerror.cc/docs/local/LAN'
  if (environmentDetector.isTauriEnvironment) {
    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener')
      await openUrl(url)
    } catch (error) {
      window.open(url, '_blank')
    }
  } else {
    window.open(url, '_blank')
  }
}

// 主题管理
const { setTheme } = useTheme()

// 本地设置状态
const localSettings = ref({
  theme: 'auto' as 'light' | 'dark' | 'auto'
})

// 处理主题变更
const handleThemeChange = async (theme: 'light' | 'dark' | 'auto') => {
  localSettings.value.theme = theme
  setSetting('theme', theme)
  await setTheme(theme)
  await saveSettings()
}

// 同步本地设置
const syncLocalSettings = () => {
  localSettings.value = {
    theme: settings.value.theme || 'auto'
  }
}

onMounted(() => {
  syncLocalSettings()
})
</script>

<style scoped>
.setting-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 18px 0;
  border-bottom: 1px solid var(--border-color);
}

.setting-item:last-child {
  border-bottom: none;
}

.setting-info {
  flex: 1;
  margin-right: 18px;
}

.setting-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
  margin: 0 0 6px 0;
}

.setting-description {
  font-size: 11px;
  color: var(--text-secondary);
  margin: 0;
  line-height: 1.4;
}

.setting-control {
  flex-shrink: 0;
}

.prompt-editor-control {
  width: min(520px, 100%);
}

.system-prompt-textarea {
  width: 100%;
  min-height: 140px;
  padding: 10px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 12px;
  line-height: 1.5;
  resize: vertical;
  box-sizing: border-box;
}

.prompt-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 10px;
}

.folder-action-btn {
  --folder-btn-bg: var(--bg-secondary);
  --folder-btn-text: var(--text-primary);
  --folder-btn-border: var(--border-color);
  --folder-btn-hover-bg: var(--hover-bg);
  --folder-btn-hover-border: var(--border-secondary);
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid var(--folder-btn-border);
  background: var(--folder-btn-bg);
  color: var(--folder-btn-text);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.2s ease, border-color 0.2s ease, opacity 0.2s ease !important;
}

.folder-action-btn:hover {
  background: var(--folder-btn-hover-bg);
  border-color: var(--folder-btn-hover-border);
}

.folder-action-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.open-folder-btn {
  --folder-btn-bg: var(--general-settings-open-folder-btn-bg);
  --folder-btn-text: var(--general-settings-open-folder-btn-text);
  --folder-btn-border: var(--general-settings-open-folder-btn-border);
  --folder-btn-hover-bg: var(--general-settings-open-folder-btn-hover-bg);
  --folder-btn-hover-border: var(--general-settings-open-folder-btn-hover-border);
}

.select-folder-btn {
  --folder-btn-bg: var(--general-settings-select-folder-btn-bg);
  --folder-btn-text: var(--general-settings-select-folder-btn-text);
  --folder-btn-border: var(--general-settings-select-folder-btn-border);
  --folder-btn-hover-bg: var(--general-settings-select-folder-btn-hover-bg);
  --folder-btn-hover-border: var(--general-settings-select-folder-btn-hover-border);
}



/* 按钮阴影扩散动画 */
.btn-ripple {
  position: relative;
  overflow: visible;
  /* 确保动画不受全局 transition 干扰 */
  transition: none !important;
  animation: ripple-spread 0.6s cubic-bezier(0.23, 1, 0.32, 1);
}

@keyframes ripple-spread {
  0% {
    box-shadow: 0 0 0 0 rgba(102, 126, 234, 0.4);
  }
  100% {
    box-shadow: 0 0 0 15px rgba(102, 126, 234, 0);
  }
}

.network-group {
  background: var(--network-group-bg);
  border: 1px solid var(--border-color);
  border-radius: 14px;
  padding: 0 14px;
  margin: 12px 0;
  box-shadow: 0 2px 12px rgba(0,0,0,.05);
}

.group-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  padding: 10px 0 2px 0;
  letter-spacing: 0.03em;
}

.setting-control .toggle-default {
  --toggle-active: #48bb78;
}

.network-group .setting-item:last-child {
  border-bottom: none;
}

.timeout-control {
  display: flex;
  align-items: center;
  gap: 4px;
}

.timeout-input {
  width: 80px;
  padding: 5px 8px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  font-size: 12px;
  color: var(--text-primary);
  background: var(--bg-primary);
  text-align: center;
  outline: none;
  transition: border-color 0.2s;
}

.timeout-input::-webkit-inner-spin-button,
.timeout-input::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.timeout-input {
  -moz-appearance: textfield;
}

.timeout-input:focus {
  border-color: var(--color-primary, #667eea);
}

.timeout-unit {
  font-size: 12px;
  color: var(--text-secondary);
}

.input-group {
  display: flex;
  align-items: center;
  gap: 6px;
}

.form-input[type=number] {
  text-align: center;
  -moz-appearance: textfield;
}

.form-input::-webkit-inner-spin-button,
.form-input::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}


.input-suffix {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
}

.setting-title-with-help {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 6px;
}

.setting-title-with-help .setting-title {
  margin: 0;
}

.help-button {
  background: none;
  border: none;
  cursor: pointer;
  padding: 1px;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
}

.help-button:hover {
  color: var(--text-primary);
}

.selected-folder-name {
  color: var(--color-primary);
  font-weight: 500;
}

.selected-folder-link {
  padding: 0;
  border: none;
  background: transparent;
  color: var(--color-primary);
  font: inherit;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
}

.selected-folder-link:hover {
  text-decoration: underline;
}

.selected-folder-link:disabled {
  opacity: 0.7;
  cursor: default;
  text-decoration: none;
}

.unset-hint {

  color: var(--text-secondary);
  font-style: italic;
}
</style>
