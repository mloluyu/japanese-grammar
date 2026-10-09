<script setup lang="ts">
import { computed, ref } from 'vue'
import { useData, withBase } from 'vitepress'
import { data as examplesByGrammar } from '../../../examples.data'

// 例句渲染组件（M5）：数据来自 docs/grammar/{id}.json（构建时聚合）。
// - 假名以 <ruby><rt> 输出，可切换显示；切换状态仅存于会话内存，不做本地持久化（ADR-0004）。
// - 有音频时输出原生播放器，无音频时不显示失效控件。
// - 句子元素输出 lang="ja"，站点根 lang 为 zh-CN。

interface FuriganaPart {
  text: string
  reading: string
}

interface Example {
  id: string
  text: string
  furigana: FuriganaPart[]
  translation: string
  audio: string | null
}

interface Segment {
  base: string
  reading?: string
}

const { frontmatter } = useData()
const showFurigana = ref(true)

const examples = computed<Example[]>(() => {
  const id = String(frontmatter.value.id ?? '')
  return examplesByGrammar[id] ?? []
})

// 把整句切成「无标注片段 + 标注片段」序列；furigana.text 均已在句中出现（校验器保证）。
function segmentText(text: string, furigana: FuriganaPart[]): Segment[] {
  const segments: Segment[] = []
  let rest = text
  for (const part of furigana) {
    const index = rest.indexOf(part.text)
    if (index === -1) continue
    if (index > 0) segments.push({ base: rest.slice(0, index) })
    segments.push({ base: part.text, reading: part.reading })
    rest = rest.slice(index + part.text.length)
  }
  if (rest) segments.push({ base: rest })
  return segments
}
</script>

<template>
  <div v-if="examples.length > 0" class="example-sentences">
    <button
      type="button"
      class="furigana-toggle"
      :aria-pressed="showFurigana"
      @click="showFurigana = !showFurigana"
    >
      {{ showFurigana ? '隐藏假名' : '显示假名' }}
    </button>

    <ol class="example-list">
      <li v-for="example in examples" :key="example.id" class="example">
        <p class="sentence" lang="ja">
          <template v-for="(segment, index) in segmentText(example.text, example.furigana)" :key="index">
            <ruby v-if="segment.reading && showFurigana">{{ segment.base }}<rt>{{ segment.reading }}</rt></ruby>
            <span v-else>{{ segment.base }}</span>
          </template>
        </p>
        <p class="translation">{{ example.translation }}</p>
        <p class="audio-line">
          <audio v-if="example.audio" controls preload="none" :src="withBase(example.audio)"></audio>
          <span v-else class="no-audio">暂无音频</span>
        </p>
      </li>
    </ol>
  </div>
  <p v-else class="example-missing">本条目还没有结构化例句，欢迎按指南补充。</p>
</template>

<style scoped>
.example-sentences {
  margin: 8px 0 16px;
}
.furigana-toggle {
  border: 1px solid var(--vp-c-border);
  border-radius: 8px;
  padding: 4px 12px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  cursor: pointer;
  font-size: 13px;
}
.furigana-toggle:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}
.example-list {
  list-style: none;
  margin: 12px 0 0;
  padding: 0;
  display: grid;
  gap: 14px;
}
.example {
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  padding: 12px 16px;
  background: var(--vp-c-bg-soft);
}
.sentence {
  margin: 0;
  font-size: 17px;
  line-height: 2;
}
.sentence ruby rt {
  font-size: 0.55em;
  color: var(--vp-c-text-2);
}
.translation {
  margin: 6px 0 0;
  font-size: 14px;
  color: var(--vp-c-text-2);
}
.audio-line {
  margin: 8px 0 0;
  min-height: 20px;
}
.audio-line audio {
  height: 32px;
  max-width: 100%;
}
.no-audio {
  font-size: 12px;
  color: var(--vp-c-text-3);
}
.example-missing {
  color: var(--vp-c-text-2);
}
</style>
