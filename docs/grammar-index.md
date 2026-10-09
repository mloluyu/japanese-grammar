---
title: 语法索引
---

<script setup>
import GrammarIndex from './.vitepress/theme/components/GrammarIndex.vue'
import { data as grammar } from './grammar-index.data'
</script>

# 语法索引

按 JLPT 等级、分类与标签组合筛选，也可以直接输入关键词匹配标题、读音或标签。条目字段规范见仓库内 `project-docs/CONTENT_SCHEMA.md`；想新增条目请从[语法条目编写指南](/contribute/writing-guide)开始。

<GrammarIndex :entries="grammar" />
