<template>
  <div v-if="visible" class="dialog-overlay" @click.self="$emit('close')">
    <div class="dialog-panel fetch-dialog" role="dialog" aria-modal="true" aria-labelledby="fetch-dialog-title">
      <div class="dialog-header">
        <h3 id="fetch-dialog-title" class="dialog-title">
          获取模型结果
          <span v-if="endpointLabel" class="fetch-endpoint-tag">{{ endpointLabel }}</span>
        </h3>
        <button type="button" class="dialog-close" title="关闭" @click="$emit('close')">×</button>
      </div>

      <div class="dialog-body">
        <p v-if="error" class="fetch-error">{{ error }}</p>

        <p v-if="modelCount" class="fetch-stat">
          本次拉取到 <strong>{{ modelCount }}</strong> 个可对话模型<template v-if="total !== undefined"> · 供应商共 {{ total }} 个<template v-if="filteredOut"> · 跳过非对话/无能力标签 {{ filteredOut }} 个</template></template>
        </p>

        <div v-if="added.length" class="fetch-section">
          <div class="fetch-section-head">
            <h4>新增模型 ({{ added.length }}) — 勾选以启用</h4>
            <button type="button" class="fetch-tool-btn" @click="toggleAllAdded">
              {{ allAddedChecked ? '取消全选' : '全选' }}
            </button>
          </div>
          <div class="fetch-list">
            <label v-for="m in added" :key="m.id" class="fetch-item">
              <input type="checkbox" v-model="checkedAdded" :value="m.id" />
              <span class="fetch-item-id">{{ m.id }}</span>
              <!-- 对话类模型都具备文本能力；有能力标签且含视觉理解时追加视觉标签 -->
              <span class="fetch-type-tag fetch-type-text">文本</span>
              <span v-if="m.category === 'vision'" class="fetch-type-tag fetch-type-vision">视觉</span>
              <span v-if="m.source === 'guess'" class="fetch-guess-tag" title="供应商未提供能力标签，按名称推断，可能不准">名称推断</span>
            </label>
          </div>
        </div>

        <div v-if="expired.length" class="fetch-section">
          <div class="fetch-section-head">
            <h4>失效模型 ({{ expired.length }}) — 勾选以删除</h4>
            <button type="button" class="fetch-tool-btn" @click="toggleAllExpired">全选删除</button>
          </div>
          <div class="fetch-list">
            <label v-for="id in expired" :key="id" class="fetch-item fetch-item--expired">
              <input type="checkbox" v-model="checkedExpired" :value="id" />
              <span class="fetch-item-id">{{ id }}</span>
            </label>
          </div>
        </div>

        <p v-if="!added.length && !expired.length" class="fetch-empty">模型列表已是最新，无变更。</p>
      </div>

      <div class="dialog-footer">
        <span class="fetch-summary">启用 {{ checkedAdded.length }}/{{ added.length }} · 删除 {{ checkedExpired.length }}/{{ expired.length }}</span>
        <button type="button" class="btn-cancel" @click="$emit('close')">取消</button>
        <button type="button" class="btn-confirm" :disabled="!added.length && !expired.length" @click="apply">应用</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { FetchedModel } from '../../../services/model/fetchModels'

const props = defineProps<{
  visible: boolean
  added: FetchedModel[]
  expired: string[]
  endpoint?: 'native' | 'compatible'
  error?: string
  /** 供应商报告的总模型数（诊断用） */
  total?: number
  /** 被能力标签跳过的条数（诊断用） */
  filteredOut?: number
  /** 本次拉到的可对话模型数（诊断用） */
  modelCount?: number
}>()

const emit = defineEmits<{
  close: []
  apply: [enabledIds: string[], removedIds: string[]]
}>()

const checkedAdded = ref<string[]>([])
const checkedExpired = ref<string[]>([])

watch(() => props.visible, (v) => {
  if (!v) return
  // 新模型默认全选（加入即启用），失效模型默认不删
  checkedAdded.value = props.added.map(m => m.id)
  checkedExpired.value = []
})

const allAddedChecked = computed(() =>
  props.added.length > 0 && checkedAdded.value.length === props.added.length
)

const toggleAllAdded = () => {
  checkedAdded.value = allAddedChecked.value ? [] : props.added.map(m => m.id)
}
const toggleAllExpired = () => {
  checkedExpired.value = checkedExpired.value.length === props.expired.length
    ? []
    : [...props.expired]
}

const endpointLabel = computed(() =>
  props.endpoint === 'native' ? '供应商能力标签' : props.endpoint === 'compatible' ? '名称推断' : ''
)

const apply = () => {
  emit('apply', [...checkedAdded.value], [...checkedExpired.value])
}
</script>

<style scoped>
.dialog-overlay {
  position: fixed; inset: 0; z-index: 1000;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, .55);
}
.dialog-panel {
  width: min(560px, 92vw); max-height: 82vh;
  display: flex; flex-direction: column;
  background: var(--bg-secondary, #1e1e1e);
  border: 1px solid var(--border-color, #333);
  border-radius: 12px;
  box-shadow: 0 18px 60px rgba(0, 0, 0, .45);
  color: var(--text-primary, #eaeaea);
}
.dialog-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px; border-bottom: 1px solid var(--border-color, #333);
}
.dialog-title { margin: 0; font-size: 16px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
.fetch-endpoint-tag {
  font-size: 11px; font-weight: 400; padding: 2px 8px; border-radius: 99px;
  background: rgba(0, 185, 107, .12); color: #00b96b;
}
.dialog-close {
  background: none; border: none; color: var(--text-secondary, #999);
  font-size: 22px; line-height: 1; cursor: pointer; padding: 0 4px;
}
.dialog-close:hover { color: var(--text-primary, #eaeaea); }
.dialog-body { padding: 16px 20px; overflow-y: auto; flex: 1; }
.fetch-error {
  margin: 0 0 12px; padding: 10px 12px; border-radius: 8px;
  background: rgba(255, 77, 79, .1); color: #ff7875; font-size: 12px; line-height: 1.5;
}
.fetch-stat {
  margin: 0 0 12px; padding: 8px 12px; border-radius: 8px;
  background: rgba(22, 119, 255, .08); color: var(--text-secondary, #999);
  font-size: 12px; line-height: 1.5;
}
.fetch-stat strong { color: #1677ff; font-weight: 600; }
.fetch-section { margin-bottom: 18px; }
.fetch-section-head {
  display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;
}
.fetch-section-head h4 { margin: 0; font-size: 13px; font-weight: 500; color: var(--text-secondary, #aaa); }
.fetch-tool-btn {
  background: none; border: none; color: #1677ff; cursor: pointer; font-size: 12px; padding: 2px 4px;
}
.fetch-tool-btn:hover { text-decoration: underline; }
.fetch-list { display: flex; flex-direction: column; gap: 2px; }
.fetch-item {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 10px; border-radius: 6px; cursor: pointer;
  background: rgba(0, 0, 0, .04); font-size: 13px;
}
.fetch-item:hover { background: rgba(0, 0, 0, .08); }
.fetch-item input[type="checkbox"] { accent-color: #00b96b; margin: 0; }
.fetch-item-id { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fetch-item--expired .fetch-item-id { text-decoration: line-through; color: var(--text-tertiary, #777); }
.fetch-type-tag { font-size: 11px; padding: 1px 7px; border-radius: 99px; }
.fetch-type-text { background: rgba(22, 119, 255, .12); color: #1677ff; }
.fetch-type-vision { background: rgba(0, 185, 107, .12); color: #00b96b; }
.fetch-type-summary { background: rgba(99, 114, 189, .12); color: #6372bd; }
.fetch-guess-tag { font-size: 11px; color: var(--text-tertiary, #777); }
.fetch-empty { text-align: center; color: var(--text-secondary, #999); font-size: 13px; padding: 24px 0; }
.dialog-footer {
  display: flex; align-items: center; gap: 10px;
  padding: 14px 20px; border-top: 1px solid var(--border-color, #333);
}
.fetch-summary { flex: 1; font-size: 12px; color: var(--text-secondary, #999); }
.btn-cancel, .btn-confirm {
  padding: 7px 16px; border-radius: 6px; cursor: pointer; font-size: 13px;
}
.btn-cancel { background: transparent; border: 1px solid var(--border-color, #444); color: var(--text-primary, #eaeaea); }
.btn-confirm { background: #1677ff; border: 1px solid #1677ff; color: #fff; }
.btn-confirm:disabled { opacity: .5; cursor: not-allowed; }
</style>
