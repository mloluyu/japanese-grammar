<script setup>
// 友链卡片数据：theme/data/friend-links.json
// 新增友链只改 JSON（name/url/desc/addedAt），页面与组件不动。
import links from '../data/friend-links.json'
</script>

<template>
  <p v-if="links.length === 0" class="flinks-empty">暂无友链。</p>
  <div v-else class="flinks-grid">
    <a
      v-for="l in links"
      :key="l.url"
      class="flinks-card"
      :href="l.url"
      target="_blank"
      rel="noopener"
    >
      <span class="flinks-name">{{ l.name }}</span>
      <span class="flinks-desc">{{ l.desc }}</span>
    </a>
  </div>
</template>

<style scoped>
.flinks-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 12px;
}
.flinks-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  padding: 14px 16px;
  transition: border-color 0.25s;
}
.flinks-card:hover {
  border-color: var(--vp-c-brand-1);
}
.flinks-name {
  font-weight: 600;
}
.flinks-desc {
  font-size: 13px;
  color: var(--vp-c-text-2);
  line-height: 1.5;
}
.flinks-empty {
  color: var(--vp-c-text-2);
}
</style>
