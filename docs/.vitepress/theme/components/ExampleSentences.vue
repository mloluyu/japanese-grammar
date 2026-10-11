<script setup lang="ts">
import { computed, ref } from 'vue'
import { useData, withBase } from 'vitepress'
import { data as examplesByGrammar } from '../../../examples.data'

// 例句渲染组件（M5）：数据来自 docs/grammar/{id}.json（构建时聚合）。
// - 假名以 <ruby><rt> 输出，可切换显示；切换状态仅存于会话内存，不做本地持久化（ADR-0004）。
// - 有音频时输出自绘播放按钮（不提供下载入口，见 ADR-0005），无音频时不显示失效控件。
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

// 例句音频仅限站内收听（ADR-0005），因此不提供原生播放器（自带下载入口），
// 改为自绘播放按钮：一次只播一句，音频元素按需创建并缓存在会话内存中。
const playingId = ref<string | null>(null)
const loadingId = ref<string | null>(null)
const failedId = ref<string | null>(null)
const audioEls = new Map<string, HTMLAudioElement>()
let currentEl: HTMLAudioElement | null = null

function getAudio(url: string): HTMLAudioElement {
  let el = audioEls.get(url)
  if (!el) {
    el = new Audio()
    el.preload = 'none'
    el.src = url
    audioEls.set(url, el)
  }
  return el
}

async function togglePlay(example: Example) {
  if (!example.audio) return
  failedId.value = null
  if (playingId.value === example.id && currentEl) {
    currentEl.pause()
    playingId.value = null
    return
  }
  currentEl?.pause()
  const el = getAudio(withBase(example.audio))
  currentEl = el
  loadingId.value = example.id
  try {
    el.currentTime = 0
    await el.play()
    el.onended = () => {
      if (playingId.value === example.id) playingId.value = null
    }
    playingId.value = example.id
  } catch {
    failedId.value = example.id
  } finally {
    loadingId.value = null
  }
}

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
          <button
            v-if="example.audio"
            type="button"
            class="play-btn"
            :class="{ 'is-playing': playingId === example.id }"
            :aria-label="playingId === example.id ? '暂停例句发音' : '播放例句发音'"
            @click="togglePlay(example)"
          >
            <svg v-if="playingId === example.id" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 5h4v14H6zM14 5h4v14h-4z" fill="currentColor" />
            </svg>
            <svg v-else viewBox="0 0 24 24" aria-hidden="true">
              <path d="M8 5v14l11-7z" fill="currentColor" />
            </svg>
            <span v-if="loadingId === example.id">加载中…</span>
            <span v-else-if="failedId === example.id">播放失败，点击重试</span>
            <span v-else>{{ playingId === example.id ? '暂停' : '播放发音' }}</span>
          </button>
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
  min-height: 26px;
  display: flex;
  align-items: center;
}
.play-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--vp-c-border);
  border-radius: 999px;
  padding: 3px 12px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  cursor: pointer;
  font-size: 13px;
  line-height: 20px;
  transition: border-color 0.2s, color 0.2s;
}
.play-btn:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}
.play-btn.is-playing {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
  background: var(--vp-c-bg-soft);
}
.play-btn svg {
  width: 14px;
  height: 14px;
}
.no-audio {
  font-size: 12px;
  color: var(--vp-c-text-3);
}
.example-missing {
  color: var(--vp-c-text-2);
}
</style>
