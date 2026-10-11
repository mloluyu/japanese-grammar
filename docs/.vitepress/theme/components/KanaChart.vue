<script lang="ts">
// 模块级共享：三个表格（清音/浊音/拗音）实例共用一个「当前播放」，避免同时出声。
const audioCache = new Map<string, HTMLAudioElement>()
let sharedEl: HTMLAudioElement | null = null

function getAudio(url: string): HTMLAudioElement {
  let el = audioCache.get(url)
  if (!el) {
    el = new Audio()
    el.preload = 'none'
    el.src = url
    audioCache.set(url, el)
  }
  return el
}
</script>

<script setup lang="ts">
import { ref } from 'vue'
import { withBase } from 'vitepress'
import data from '../data/kana-data.json'

// 五十音速查表（docs/kana/index.md 用）：假名格可点击听发音。
// 音频由 scripts/generate-kana-audio.mjs 从同一数据文件生成（docs/public/audio/kana/{slug}.mp3）；
// 发音仅限站内收听（ADR-0005），因此同样不提供下载入口。
interface KanaCell {
  h: string
  k: string
  r: string
  s?: string
}

interface KanaRow {
  row: string
  wide?: boolean
  cells: (KanaCell | null)[]
}

const props = defineProps<{ part: 'seion' | 'dakuten' | 'yoon' }>()

const playingSlug = ref<string | null>(null)
const failedSlug = ref<string | null>(null)
let failTimer: ReturnType<typeof setTimeout> | null = null

const group = data[props.part]
const rows: KanaRow[] = props.part === 'yoon' ? [] : (group as { rows: KanaRow[] }).rows
const yoonCells: KanaCell[] = props.part === 'yoon' ? (group as { cells: KanaCell[] }).cells : []

async function play(cell: KanaCell) {
  const slug = cell.s ?? cell.r
  failedSlug.value = null
  if (failTimer) { clearTimeout(failTimer); failTimer = null }
  if (playingSlug.value === slug && sharedEl) {
    sharedEl.pause()
    playingSlug.value = null
    return
  }
  sharedEl?.pause()
  const el = getAudio(withBase(`/audio/kana/${slug}.mp3`))
  sharedEl = el
  try {
    el.currentTime = 0
    await el.play()
    el.onended = () => {
      if (playingSlug.value === slug) playingSlug.value = null
    }
    playingSlug.value = slug
  } catch {
    failedSlug.value = slug
    failTimer = setTimeout(() => { failedSlug.value = null }, 2000)
  }
}
</script>

<template>
  <div v-if="part !== 'yoon'" class="kana-chart">
    <div
      v-for="row in rows"
      :key="row.row"
      class="chart-row"
      :class="{ wide: row.wide }"
    >
      <div class="row-label">{{ row.row }}</div>
      <template v-for="(cell, i) in row.cells" :key="i">
        <button
          v-if="cell"
          type="button"
          class="kana-cell"
          :class="{ 'is-playing': playingSlug === (cell.s ?? cell.r), 'is-failed': failedSlug === (cell.s ?? cell.r) }"
          :aria-label="`播放 ${cell.h}（${cell.r}）的发音`"
          @click="play(cell)"
        >
          <span class="pair"><span class="hira">{{ cell.h }}</span><span class="kata">{{ cell.k }}</span></span>
          <span class="romaji">{{ cell.r }}</span>
        </button>
        <span v-else class="cell-empty" aria-hidden="true"></span>
      </template>
    </div>
  </div>

  <div v-else class="yoon-grid">
    <button
      v-for="cell in yoonCells"
      :key="cell.h"
      type="button"
      class="kana-cell"
      :class="{ 'is-playing': playingSlug === (cell.s ?? cell.r), 'is-failed': failedSlug === (cell.s ?? cell.r) }"
      :aria-label="`播放 ${cell.h}（${cell.r}）的发音`"
      @click="play(cell)"
    >
      <span class="pair"><span class="hira">{{ cell.h }}</span><span class="kata">{{ cell.k }}</span></span>
      <span class="romaji">{{ cell.r }}</span>
    </button>
  </div>
</template>

<style scoped>
.chart-row {
  display: grid;
  grid-template-columns: 3.4em repeat(5, minmax(0, 1fr));
  gap: 6px;
}
.row-label {
  align-self: center;
  font-size: 12px;
  color: var(--vp-c-text-3);
}
.kana-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg);
  padding: 7px 2px 5px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.kana-cell:hover {
  border-color: var(--vp-c-brand-1);
}
.kana-cell.is-playing {
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
}
.kana-cell.is-failed {
  border-color: var(--vp-c-danger-1);
}
.pair {
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.hira {
  font-size: 21px;
  line-height: 1.3;
}
.kata {
  font-size: 12px;
  color: var(--vp-c-text-3);
}
.romaji {
  font-size: 11px;
  color: var(--vp-c-text-3);
}
.cell-empty {
  border: 1px dashed var(--vp-c-divider);
  border-radius: 8px;
  opacity: 0.35;
}
.wide .kana-cell {
  grid-column: 2 / -1;
  flex-direction: row;
  justify-content: center;
  gap: 6px;
  padding: 5px 2px;
}
.wide .hira {
  font-size: 18px;
}
.wide .romaji {
  font-size: 12px;
}
.yoon-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(92px, 1fr));
  gap: 6px;
}
@media (max-width: 639px) {
  .chart-row {
    grid-template-columns: repeat(5, minmax(0, 1fr));
  }
  .row-label {
    grid-column: 1 / -1;
    padding-bottom: 2px;
  }
  .wide .kana-cell {
    grid-column: 1 / -1;
  }
  .hira {
    font-size: 19px;
  }
}
</style>
