<template>
  <div v-if="visible" class="dialog-overlay" @click="handleOverlayClick">
    <div class="dialog-panel fetch-models-panel" @click.stop>
      <div class="dialog-header">
        <button class="btn-back" type="button" @click="$emit('cancel')" title="取消">
          <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="18" height="18">
            <path d="M768 96c19.2-19.2 19.2-51.2 0-70.4-19.2-19.2-51.2-19.2-70.4 0l-448 448c-19.2 19.2-19.2 51.2 0 70.4l448 448c19.2 19.2 51.2 19.2 70.4 0 19.2-19.2 19.2-51.2 0-70.4L358.4 512l409.6-416z" fill="currentColor"/>
          </svg>
        </button>
        <h3 class="dialog-title">拉取到的模型（{{ items.length }}）</h3>
        <button class="btn-primary-confirm" type="button" :disabled="selectedIds.length === 0" @click="handleConfirm">
          添加 {{ selectedIds.length > 0 ? selectedIds.length + ' 个' : '' }}
        </button>
      </div>

      <div class="dialog-body">
        <div class="fetch-toolbar">
          <button type="button" class="fetch-tool-btn" @click="selectAll">全选新增</button>
          <button type="button" class="fetch-tool-btn" @click="clearAll">清空</button>
          <span class="fetch-hint">已存在的模型不会重复添加</span>
        </div>
        <div class="fetch-list">
          <label
            v-for="item in items"
            :key="item.id"
            class="fetch-item"
            :class="{ 'fetch-item--exists': item.exists }"
          >
            <input type="checkbox" :value="item.id" v-model="selectedIds" :disabled="item.exists" />
            <span class="fetch-item-id">{{ item.id }}</span>
            <span v-if="item.exists" class="fetch-exists-tag">已存在</span>
          </label>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'

export interface FetchModelItem {
  id: string
  exists: boolean
}

const props = defineProps<{
  visible: boolean
  items: FetchModelItem[]
}>()

const emit = defineEmits<{
  confirm: [ids: string[]]
  cancel: []
}>()

const selectedIds = ref<string[]>([])

// 每次打开时默认勾选全部新模型
watch(() => props.visible, (v) => {
  if (v) {
    selectedIds.value = props.items.filter(i => !i.exists).map(i => i.id)
  }
})

const selectAll = () => {
  selectedIds.value = props.items.filter(i => !i.exists).map(i => i.id)
}

const clearAll = () => {
  selectedIds.value = []
}

const handleConfirm = () => {
  if (selectedIds.value.length > 0) {
    emit('confirm', [...selectedIds.value])
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

.fetch-item-id {
  font-family: monospace;
  word-break: break-all;
}

.fetch-exists-tag {
  margin-left: auto;
  flex-shrink: 0;
  font-size: 12px;
  color: var(--text-secondary);
}
</style>
