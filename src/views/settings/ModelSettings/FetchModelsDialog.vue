<template>
  <div v-if="visible" class="dialog-overlay" @click="handleOverlayClick">
    <div class="dialog-panel fetch-models-panel" @click.stop>
      <div class="dialog-header">
        <button class="btn-back" type="button" @click="$emit('cancel')" title="取消">
          <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="18" height="18">
            <path d="M768 96c19.2-19.2 19.2-51.2 0-70.4-19.2-19.2-51.2-19.2-70.4 0l-448 448c-19.2 19.2-19.2 51.2 0 70.4l448 448c19.2 19.2 51.2 19.2 70.4 0 19.2-19.2 19.2-51.2 0-70.4L358.4 512l409.6-416z" fill="currentColor"/>
          </svg>
        </button>
        <h3 class="dialog-title">
          拉取到的{{ categoryLabel }}模型（{{ scopedItems.length }}<template v-if="!showAll && hiddenCount > 0"> / 共 {{ items.length }}</template>）
        </h3>
        <button class="btn-primary-confirm" type="button" :disabled="selectedIds.length === 0" @click="handleConfirm">
          添加 {{ selectedIds.length > 0 ? selectedIds.length + ' 个' : '' }}
        </button>
      </div>

      <div class="dialog-body">
        <div class="search-wrap">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35" stroke-linecap="round"/>
          </svg>
          <input
            type="text"
            class="search-input"
            placeholder="搜索模型..."
            v-model="searchQuery"
          />
        </div>
        <div class="fetch-toolbar">
          <button type="button" class="fetch-tool-btn" @click="selectAll">全选新增</button>
          <button type="button" class="fetch-tool-btn" @click="clearAll">清空</button>
          <button
            v-if="hiddenCount > 0 || showAll"
            type="button"
            class="fetch-tool-btn"
            :title="`接口返回 ${items.length} 个模型，其中 ${hiddenCount} 个不属于当前页签`"
            @click="toggleShowAll"
          >{{ showAll ? `仅看${categoryLabel}` : `显示全部（含 ${hiddenCount} 个其他）` }}</button>
          <span class="fetch-hint">{{ showAll ? '已显示全部模型，类型可逐行修改' : '按模型命名预填类型，可逐行修改' }}</span>
        </div>
        <div v-if="filteredItems.length === 0" class="fetch-empty">
          <template v-if="searchQuery.trim()">没有匹配「{{ searchQuery.trim() }}」的模型<template v-if="!showAll">，可点下方「显示全部」再搜</template></template>
          <template v-else-if="showAll">没有可选的模型</template>
          <template v-else>
            接口未识别出{{ categoryLabel }}模型。
            <button type="button" class="fetch-tool-btn" @click="toggleShowAll">显示全部 {{ items.length }} 个</button>
            后手动改类型
          </template>
        </div>
        <div class="fetch-list">
          <label
            v-for="item in filteredItems"
            :key="item.id"
            class="fetch-item"
            :class="{ 'fetch-item--exists': item.exists }"
          >
            <input type="checkbox" :value="item.id" v-model="selectedIds" :disabled="item.exists" />
            <span class="fetch-item-id">{{ item.id }}</span>
            <select
              class="fetch-type-select"
              :value="modelTypes[item.id] || 'text'"
              :disabled="item.exists"
              title="模型类型：文本=普通问答，视觉=图片识别"
              @click.stop
              @change.stop="setModelType(item.id, ($event.target as HTMLSelectElement).value as 'text' | 'vision')"
            >
              <option value="text">文本</option>
              <option value="vision">视觉</option>
            </select>
            <span v-if="item.exists" class="fetch-exists-tag">已存在</span>
          </label>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { guessModelCategory, matchesTab } from '../../../utils/modelCategory'

export interface FetchModelItem {
  id: string
  exists: boolean
}

const props = defineProps<{
  visible: boolean
  items: FetchModelItem[]
  /** 当前页签：弹窗默认只列出与该页签匹配的模型 */
  category: 'text' | 'vision' | 'summary'
}>()

const emit = defineEmits<{
  confirm: [added: { id: string; category: 'text' | 'vision' }[]]
  cancel: []
}>()

const selectedIds = ref<string[]>([])
const modelTypes = ref<Record<string, 'text' | 'vision'>>({})
const searchQuery = ref('')
// 命名启发式并非可靠（不含 vl/vision/数字+v 关键词的视觉模型会被判成文本），
// 因此过滤必须可解除，否则这类模型在视觉页签永远拉不到
const showAll = ref(false)

const categoryLabel = computed(() => {
  if (props.category === 'vision') return '识图'
  if (props.category === 'summary') return '总结'
  return '文本'
})

const matchesTarget = (id: string): boolean => matchesTab(id, props.category)

// 当前页签匹配的模型（未叠加搜索）
const scopedItems = computed(() =>
  showAll.value ? props.items : props.items.filter(i => matchesTarget(i.id))
)

const hiddenCount = computed(() => props.items.filter(i => !matchesTarget(i.id)).length)

// 列表搜索过滤（与模型选择弹窗一致的交互）
const filteredItems = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  return q ? scopedItems.value.filter(i => i.id.toLowerCase().includes(q)) : scopedItems.value
})

// 每次打开时默认勾选当前页签下的全部新模型，并初始化类型
watch(() => props.visible, (v) => {
  if (v) {
    searchQuery.value = ''
    showAll.value = false
    const scoped = props.items.filter(i => matchesTarget(i.id))
    selectedIds.value = scoped.filter(i => !i.exists).map(i => i.id)
    const types: Record<string, 'text' | 'vision'> = {}
    for (const item of props.items) types[item.id] = guessModelCategory(item.id)
    modelTypes.value = types
  }
})

const setModelType = (id: string, type: 'text' | 'vision') => {
  modelTypes.value[id] = type
}

// 只勾选当前可见（匹配页签）的新模型，避免把被过滤掉的模型静默加进来
const selectAll = () => {
  selectedIds.value = scopedItems.value.filter(i => !i.exists).map(i => i.id)
}

const clearAll = () => {
  selectedIds.value = []
}

const toggleShowAll = () => {
  showAll.value = !showAll.value
  // 解除过滤时不自动勾选新出现的模型，交由用户决定
}

const handleConfirm = () => {
  if (selectedIds.value.length > 0) {
    emit('confirm', selectedIds.value.map(id => ({
      id,
      category: modelTypes.value[id] === 'vision' ? 'vision' as const : 'text' as const
    })))
  }
}

const handleOverlayClick = (event: MouseEvent) => {
  const target = event.target as HTMLElement
  if (target.tagName === 'INPUT' || target.closest('input')) {
    return
  }
  setTimeout(() => {
    const selection = window.getSelection()
    if (selection && selection.toString().length > 0) {
      return
    }
    const activeElement = document.activeElement
    if (activeElement && activeElement.tagName === 'INPUT') {
      return
    }
    emit('cancel')
  }, 0)
}
</script>

<style>
@import '../../../styles/dialog.css';
</style>

<style scoped>
.dialog-overlay {
  background: var(--platform-config-overlay-bg);
  z-index: 2000;
}

.fetch-models-panel {
  max-width: 560px;
  width: 90%;
  display: flex;
  flex-direction: column;
}

.btn-primary-confirm {
  background: #4f6ef7;
  border: none;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  color: #fff;
  padding: 6px 14px;
  border-radius: 999px;
  transition: opacity 0.15s ease;
  flex-shrink: 0;
}

.btn-primary-confirm:hover {
  opacity: 0.85;
}

.btn-primary-confirm:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.fetch-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.fetch-tool-btn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 13px;
  color: #4f6ef7;
  padding: 2px 4px;
}

.fetch-tool-btn:hover {
  text-decoration: underline;
}

.fetch-hint {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-secondary);
}

.fetch-list {
  max-height: 50vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.fetch-empty {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  padding: 18px 10px;
  font-size: 13px;
  color: var(--text-secondary);
}

.fetch-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 10px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
  color: var(--platform-config-dialog-title-text);
}

.fetch-item:hover {
  background: var(--platform-config-overlay-bg);
}

.fetch-item--exists {
  opacity: 0.5;
  cursor: not-allowed;
}

.search-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--form-input-bg, #F7F7F7);
  border-radius: 8px;
  margin-bottom: 12px;
  color: var(--text-secondary);
}

.search-input {
  flex: 1;
  border: none;
  background: transparent;
  outline: none;
  font-size: 14px;
  color: var(--text-primary);
}

.fetch-item-id {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  font-weight: 500;
  word-break: break-all;
}

.fetch-type-select {
  flex-shrink: 0;
  margin-left: auto;
  font-size: 12px;
  padding: 2px 6px;
  border-radius: 6px;
  border: 1px solid var(--border-color, rgba(128, 128, 128, 0.3));
  background: var(--platform-config-overlay-bg);
  color: var(--platform-config-dialog-title-text);
  cursor: pointer;
}

.fetch-type-select:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.fetch-exists-tag {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--text-secondary);
}
</style>
