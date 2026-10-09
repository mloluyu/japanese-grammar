<script setup lang="ts">
import { computed } from 'vue'
import { useData, withBase } from 'vitepress'
import { data as grammar } from '../../../grammar-index.data'

// 「相关语法」列表：由 Frontmatter 的 related 自动渲染，正文不手写链接。
// 规范见 project-docs/CONTENT_SCHEMA.md 第 3 节。
const { frontmatter } = useData()

const related = computed(() => {
  const ids = Array.isArray(frontmatter.value.related) ? frontmatter.value.related.map(String) : []
  return ids
    .map((id) => grammar.find((entry) => entry.id === id))
    .filter((entry): entry is (typeof grammar)[number] => Boolean(entry))
})
</script>

<template>
  <section v-if="related.length > 0" class="related-grammar">
    <h2>相关语法</h2>
    <ul>
      <li v-for="item in related" :key="item.id">
        <a :href="withBase(item.url)">{{ item.title }}</a>
        <span class="level-badge">{{ item.jlpt }}</span>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.related-grammar {
  margin-top: 32px;
  padding-top: 20px;
  border-top: 1px solid var(--vp-c-divider);
}
.related-grammar h2 {
  font-size: 18px;
  margin-bottom: 8px;
}
.related-grammar ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.related-grammar li {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 999px;
  padding: 4px 12px;
  background: var(--vp-c-bg-soft);
}
.related-grammar a {
  font-weight: 500;
}
.level-badge {
  font-size: 12px;
  color: var(--vp-c-brand-1);
}
</style>
