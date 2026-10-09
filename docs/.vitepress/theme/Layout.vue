<script setup lang="ts">
import DefaultTheme from 'vitepress/theme'
import { useData } from 'vitepress'
import PracticeQuiz from './components/PracticeQuiz.vue'
import RelatedGrammar from './components/RelatedGrammar.vue'

// 仅在语法条目页（Frontmatter 同时具备 id 与 category）之后注入练习与「相关语法」。
// 练习在先：读完释义与例句紧接着做题；相关语法在最后，供继续深入。
const { Layout } = DefaultTheme
const { frontmatter } = useData()
</script>

<template>
  <Layout>
    <template #doc-after>
      <template v-if="frontmatter.id && frontmatter.category">
        <PracticeQuiz />
        <RelatedGrammar />
      </template>
    </template>
  </Layout>
</template>
