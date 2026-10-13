<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { withBase } from 'vitepress'
import categories from '../../categories.json'

interface GrammarEntry {
  id: string
  title: string
  summary: string
  reading: string
  jlpt: string
  category: string
  tags: string[]
  url: string
}

// 语法索引页放宽版心：组件挂载期间在 <html> 上挂标记类，
// 覆盖 VitePress 的 --vp-layout-max-width；离开页面即摘除，不影响其他页。
const WIDE_CLASS = 'grammar-index-wide'

const props = defineProps<{ entries: GrammarEntry[] }>()

const JLPT_LEVELS = ['N5', 'N4', 'N3', 'N2', 'N1']
const categoryMeta = categories as Record<string, { label: string; description: string }>
const categoryOptions = Object.entries(categoryMeta).map(([value, meta]) => ({ value, label: meta.label }))

const query = ref('')
const jlpt = ref('ALL')
const category = ref('ALL')
const tag = ref('ALL')

const allTags = computed(() =>
  [...new Set(props.entries.flatMap((entry) => entry.tags))].sort((a, b) => a.localeCompare(b, 'zh')),
)

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  return props.entries.filter((entry) => {
    if (jlpt.value !== 'ALL' && entry.jlpt !== jlpt.value) return false
    if (category.value !== 'ALL' && entry.category !== category.value) return false
    if (tag.value !== 'ALL' && !entry.tags.includes(tag.value)) return false
    if (q) {
      const haystack = [
        entry.title,
        entry.summary,
        entry.reading,
        entry.category,
        categoryMeta[entry.category]?.label ?? '',
        ...entry.tags,
      ]
        .join(' ')
        .toLowerCase()
      if (!haystack.includes(q)) return false
    }
    return true
  })
})

const hasActiveFilters = computed(
  () => query.value !== '' || jlpt.value !== 'ALL' || category.value !== 'ALL' || tag.value !== 'ALL',
)

function reset() {
  query.value = ''
  jlpt.value = 'ALL'
  category.value = 'ALL'
  tag.value = 'ALL'
}

function categoryLabel(id: string) {
  return categoryMeta[id]?.label ?? id
}

onMounted(() => document.documentElement.classList.add(WIDE_CLASS))
onUnmounted(() => document.documentElement.classList.remove(WIDE_CLASS))
</script>

<template>
  <div class="grammar-index">
    <div class="filters">
      <input
        v-model="query"
        class="filter-query"
        type="search"
        aria-label="关键词筛选"
        placeholder="按标题、读音或标签筛选…"
      />
      <select v-model="jlpt" aria-label="JLPT 等级">
        <option value="ALL">全部等级</option>
        <option v-for="level in JLPT_LEVELS" :key="level" :value="level">{{ level }}</option>
      </select>
      <select v-model="category" aria-label="分类">
        <option value="ALL">全部分类</option>
        <option v-for="option in categoryOptions" :key="option.value" :value="option.value">
          {{ option.label }}
        </option>
      </select>
      <select v-model="tag" aria-label="标签">
        <option value="ALL">全部标签</option>
        <option v-for="item in allTags" :key="item" :value="item">{{ item }}</option>
      </select>
      <button v-if="hasActiveFilters" type="button" class="filter-reset" @click="reset">清除筛选</button>
    </div>

    <p class="result-count" role="status">共 {{ filtered.length }} 条</p>

    <p v-if="filtered.length === 0" class="empty-state">
      没有符合条件的结果。试试放宽筛选，或点击「清除筛选」。
    </p>

    <ul v-else class="entry-grid">
      <li v-for="entry in filtered" :key="entry.id" class="entry-card">
        <a :href="withBase(entry.url)" class="entry-title">{{ entry.title }}</a>
        <p v-if="entry.summary" class="entry-summary">{{ entry.summary }}</p>
        <p v-else-if="entry.reading" class="entry-reading" lang="ja">{{ entry.reading }}</p>
        <p class="entry-meta">
          <span v-if="entry.jlpt" class="badge level">{{ entry.jlpt }}</span>
          <span class="badge category">{{ categoryLabel(entry.category) }}</span>
          <span v-for="item in entry.tags" :key="item" class="badge tag">{{ item }}</span>
        </p>
      </li>
    </ul>
  </div>
</template>

<style scoped>
:global(html.grammar-index-wide) {
  --vp-layout-max-width: 1728px;
}
/* grammar-index.md 为 aside:false 的独立页，走 .VPDoc:not(.has-sidebar) 分支：
   该分支的 .container(992/1104px) 与 .content(752/784px) 硬顶比 --vp-layout-max-width 更窄，
   全部覆盖才真正放宽；特异性 (0,5,1) 压过原规则 (0,4,0) 且不受媒体查询档位影响。 */
:global(html.grammar-index-wide .VPDoc:not(.has-sidebar) .container) {
  max-width: 1728px;
}
:global(html.grammar-index-wide .VPDoc:not(.has-sidebar) .content) {
  max-width: 100%;
}
.grammar-index {
  margin-top: 8px;
}
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.filter-query {
  flex: 1 1 200px;
  min-width: 180px;
}
.filter-query,
.filters select {
  border: 1px solid var(--vp-c-border);
  border-radius: 8px;
  padding: 6px 10px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  font-size: 14px;
}
.filter-reset {
  border: 1px solid var(--vp-c-border);
  border-radius: 8px;
  padding: 6px 12px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  cursor: pointer;
  font-size: 14px;
}
.filter-reset:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}
.result-count {
  margin: 12px 0 4px;
  font-size: 13px;
  color: var(--vp-c-text-2);
}
.empty-state {
  padding: 24px 0;
  color: var(--vp-c-text-2);
}
.entry-grid {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
}
.entry-card {
  margin: 0; /* 抵消 .vp-doc li+li 的 8px 顶边距，保持所有卡片等高对齐 */
  border: 1px solid var(--vp-c-brand-1);
  border-radius: 10px;
  padding: 12px 14px;
  background: var(--vp-c-bg);
}
.entry-title {
  font-weight: 600;
  font-size: 16px;
}
.entry-summary {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--vp-c-text-2);
  line-height: 1.6;
}
.entry-reading {
  margin: 2px 0 0;
  font-size: 13px;
  color: var(--vp-c-text-2);
}
.entry-meta {
  margin: 8px 0 0;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.badge {
  display: inline-block;
  border-radius: 999px;
  padding: 1px 8px;
  font-size: 12px;
  line-height: 18px;
}
.badge.level {
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
}
.badge.category,
.badge.tag {
  background: var(--vp-c-default-soft);
  color: var(--vp-c-text-2);
}
</style>
