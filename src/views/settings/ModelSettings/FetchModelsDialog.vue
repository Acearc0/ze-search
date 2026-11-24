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

        <details v-if="skipped && skipped.length" class="fetch-skipped">
          <summary>查看被跳过的 {{ skipped.length }} 个模型（核对某个模型是「没返回」还是「被过滤」）</summary>
          <div class="fetch-skipped-list">
            <div v-for="s in skipped" :key="s.id + s.capabilities.join(',')" class="fetch-skipped-item">
              <span class="fetch-skipped-id">{{ s.id }}</span>
              <span class="fetch-skipped-caps">{{ s.capabilities.length ? s.capabilities.join(' / ') : '无能力标签' }}</span>
            </div>
          </div>
        </details>

        <div v-if="fetched.length" class="fetch-section">
          <div class="fetch-section-head">
            <h4>
              拉取到的模型 ({{ fetched.length }})
              <span class="fetch-count-chip">已添加 {{ existingCount }}</span>
              <span class="fetch-count-chip fetch-count-chip--new">新增 {{ newCount }}</span>
            </h4>
            <div class="fetch-section-tools">
              <input v-model="keyword" class="fetch-search" type="search" placeholder="搜索模型名…" aria-label="搜索模型名" />
              <button type="button" class="fetch-tool-btn" :disabled="!visibleNewIds.length" @click="toggleAllVisible">
                {{ allVisibleChecked ? '取消全选' : '全选新增' }}
              </button>
            </div>
          </div>
          <div class="fetch-list fetch-list--main">
            <label
              v-for="m in visibleRows"
              :key="m.id"
              class="fetch-item"
              :class="{ 'fetch-item--existing': m.existing }"
            >
              <!-- 已添加的用实心勾标记（原生 disabled checkbox 在部分主题下发灰，看不出勾） -->
              <span v-if="m.existing" class="fetch-check fetch-check--done" title="该模型已在本平台，无需重复添加" aria-label="已添加">✓</span>
              <input
                v-else
                type="checkbox"
                :checked="checkedNew.includes(m.id)"
                @change="toggleOne(m)"
              />
              <span class="fetch-item-id">{{ m.id }}</span>
              <!-- 对话类模型都具备文本能力；有能力标签且含视觉理解时追加视觉标签 -->
              <span class="fetch-type-tag fetch-type-text">文本</span>
              <span v-if="m.category === 'vision'" class="fetch-type-tag fetch-type-vision">视觉</span>
              <span v-if="m.existing" class="fetch-tag-existing">已添加</span>
              <span v-else-if="m.source === 'guess'" class="fetch-guess-tag" title="供应商未提供能力标签，按名称推断，可能不准">名称推断</span>
            </label>
          </div>
          <p v-if="!visibleRows.length" class="fetch-empty fetch-empty--inline">没有匹配「{{ keyword }}」的模型。</p>
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

        <p v-if="!fetched.length && !expired.length && !error" class="fetch-empty">模型列表已是最新，无变更。</p>
      </div>

      <div class="dialog-footer">
        <span class="fetch-summary">
          新增 {{ checkedNew.length }}/{{ newCount }} · 已添加 {{ existingCount }} · 删除 {{ checkedExpired.length }}/{{ expired.length }}
        </span>
        <button type="button" class="btn-cancel" @click="$emit('close')">取消</button>
        <button type="button" class="btn-confirm" :disabled="!checkedNew.length && !checkedExpired.length" @click="apply">应用</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { FetchedModelRow, SkippedModel } from '../../../services/model/fetchModels'

const props = defineProps<{
  visible: boolean
  /** 全部拉取结果，existing=true 表示该模型已在平台里 */
  fetched: FetchedModelRow[]
  expired: string[]
  endpoint?: 'native' | 'compatible'
  error?: string
  /** 供应商报告的总模型数（诊断用） */
  total?: number
  /** 被能力标签跳过的条数（诊断用） */
  filteredOut?: number
  /** 本次拉到的可对话模型数（诊断用） */
  modelCount?: number
  /** 被跳过的模型明细（诊断用） */
  skipped?: SkippedModel[]
}>()

const emit = defineEmits<{
  close: []
  apply: [enabledIds: string[], removedIds: string[]]
}>()

/** 勾选的是「新增」模型；已添加的只展示勾选态，不参与应用 */
const checkedNew = ref<string[]>([])
const checkedExpired = ref<string[]>([])
const keyword = ref('')

const newCount = computed(() => props.fetched.filter(m => !m.existing).length)
const existingCount = computed(() => props.fetched.length - newCount.value)

const visibleRows = computed(() => {
  const k = keyword.value.trim().toLowerCase()
  if (!k) return props.fetched
  return props.fetched.filter(m => m.id.toLowerCase().includes(k))
})

const visibleNewIds = computed(() => visibleRows.value.filter(m => !m.existing).map(m => m.id))
const allVisibleChecked = computed(() =>
  visibleNewIds.value.length > 0 && visibleNewIds.value.every(id => checkedNew.value.includes(id))
)

watch(() => props.visible, (v) => {
  if (!v) return
  keyword.value = ''
  checkedExpired.value = []
  // 拉取结果是异步到达的，这里先把空态勾选清掉，等数据到了由下面的 watch 全选
  checkedNew.value = []
})

watch(() => props.fetched, (rows) => {
  if (!props.visible) return
  // 新增模型默认全选（加入即启用），已添加的不重复添加
  checkedNew.value = rows.filter(m => !m.existing).map(m => m.id)
})

const toggleOne = (m: FetchedModelRow) => {
  if (m.existing) return
  checkedNew.value = checkedNew.value.includes(m.id)
    ? checkedNew.value.filter(id => id !== m.id)
    : [...checkedNew.value, m.id]
}

const toggleAllVisible = () => {
  const ids = visibleNewIds.value
  if (!ids.length) return
  if (allVisibleChecked.value) {
    checkedNew.value = checkedNew.value.filter(id => !ids.includes(id))
  } else {
    checkedNew.value = [...new Set([...checkedNew.value, ...ids])]
  }
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
  emit('apply', [...checkedNew.value], [...checkedExpired.value])
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
.fetch-skipped {
  margin: 0 0 12px; border: 1px solid var(--border-color, #333); border-radius: 8px;
  font-size: 12px; color: var(--text-secondary, #999);
}
.fetch-skipped > summary {
  cursor: pointer; padding: 8px 12px; list-style: none;
}
.fetch-skipped > summary::-webkit-details-marker { display: none; }
.fetch-skipped > summary::before { content: '▸ '; }
.fetch-skipped[open] > summary::before { content: '▾ '; }
.fetch-skipped > summary:hover { color: var(--text-primary, #eaeaea); }
.fetch-skipped-list { max-height: 220px; overflow-y: auto; padding: 0 12px 10px; }
.fetch-skipped-item { display: flex; gap: 10px; padding: 3px 0; }
.fetch-skipped-id { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fetch-skipped-caps { color: var(--text-tertiary, #777); white-space: nowrap; }
.fetch-section { margin-bottom: 18px; }
.fetch-section-head {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  margin-bottom: 8px;
}
.fetch-section-head h4 {
  margin: 0; font-size: 13px; font-weight: 500; color: var(--text-secondary, #aaa);
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
}
.fetch-count-chip {
  font-size: 11px; font-weight: 400; padding: 1px 7px; border-radius: 99px;
  background: rgba(0, 0, 0, .06); color: var(--text-tertiary, #777);
}
.fetch-count-chip--new { background: rgba(22, 119, 255, .12); color: #1677ff; }
.fetch-section-tools { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
.fetch-search {
  width: 132px; padding: 4px 8px; font-size: 12px;
  border: 1px solid var(--border-color, #444); border-radius: 6px;
  background: transparent; color: var(--text-primary, #eaeaea); outline: none;
}
.fetch-search:focus { border-color: #1677ff; }
.fetch-tool-btn {
  background: none; border: none; color: #1677ff; cursor: pointer; font-size: 12px; padding: 2px 4px;
  white-space: nowrap;
}
.fetch-tool-btn:hover { text-decoration: underline; }
.fetch-tool-btn:disabled { color: var(--text-tertiary, #777); cursor: not-allowed; text-decoration: none; }
.fetch-list { display: flex; flex-direction: column; gap: 2px; }
.fetch-list--main { max-height: 340px; overflow-y: auto; padding-right: 2px; }
.fetch-item {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 10px; border-radius: 6px; cursor: pointer;
  background: rgba(0, 0, 0, .04); font-size: 13px;
}
.fetch-item:hover { background: rgba(0, 0, 0, .08); }
.fetch-item input[type="checkbox"] { accent-color: #00b96b; margin: 0; }
.fetch-check {
  width: 13px; height: 13px; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 3px; font-size: 10px; line-height: 1;
}
.fetch-check--done { background: #00b96b; color: #fff; font-weight: 700; }
.fetch-item-id { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fetch-item--existing { cursor: default; }
.fetch-item--existing:hover { background: rgba(0, 0, 0, .04); }
.fetch-item--expired .fetch-item-id { text-decoration: line-through; color: var(--text-tertiary, #777); }
.fetch-type-tag { font-size: 11px; padding: 1px 7px; border-radius: 99px; white-space: nowrap; }
.fetch-type-text { background: rgba(22, 119, 255, .12); color: #1677ff; }
.fetch-type-vision { background: rgba(0, 185, 107, .12); color: #00b96b; }
.fetch-type-summary { background: rgba(99, 114, 189, .12); color: #6372bd; }
.fetch-tag-existing {
  font-size: 11px; padding: 1px 7px; border-radius: 99px; white-space: nowrap;
  background: rgba(0, 0, 0, .06); color: var(--text-tertiary, #777);
}
.fetch-guess-tag { font-size: 11px; color: var(--text-tertiary, #777); white-space: nowrap; }
.fetch-empty { text-align: center; color: var(--text-secondary, #999); font-size: 13px; padding: 24px 0; }
.fetch-empty--inline { padding: 12px 0; }
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