<script setup lang="ts">
import DefaultTheme from 'vitepress/theme'
import { useData } from 'vitepress'
import RelatedGrammar from './components/RelatedGrammar.vue'

// 仅在语法条目页（Frontmatter 同时具备 id 与 category）之后注入「相关语法」列表。
const { Layout } = DefaultTheme
const { frontmatter } = useData()
</script>

<template>
  <Layout>
    <template #doc-after>
      <RelatedGrammar v-if="frontmatter.id && frontmatter.category" />
    </template>
  </Layout>
</template>
