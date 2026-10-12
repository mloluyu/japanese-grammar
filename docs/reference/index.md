---
title: 语言知识
---

<script setup>
import { data } from '../reference-index.data'
</script>

语法条目之外的参考内容：术语解释、数词等基础知识与跨条目对比。

<ul class="ref-list">
  <li v-for="p in data" :key="p.url">
    <a :href="p.url">{{ p.title }}</a>
  </li>
</ul>
