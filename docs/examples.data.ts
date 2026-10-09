import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

// 例句数据加载器：构建时聚合 docs/grammar/{语法ID}.json，
// 以 grammarId 为键输出，供例句组件按当前条目取用。
// 文件格式见 project-docs/CONTENT_SCHEMA.md 第 5 节；校验由 scripts/validate-grammar.mjs 负责。

interface FuriganaPart {
  text: string
  reading: string
}

export interface Example {
  id: string
  text: string
  furigana: FuriganaPart[]
  translation: string
  audio: string | null
}

declare const data: Record<string, Example[]>
export { data }

function resolveSrcDir(): string {
  // 与 createContentLoader 相同的配置来源；兜底为标准布局。
  const config = (globalThis as unknown as { VITEPRESS_CONFIG?: { srcDir?: string } }).VITEPRESS_CONFIG
  return config?.srcDir ?? path.resolve(process.cwd(), 'docs')
}

export default {
  async load(): Promise<Record<string, Example[]>> {
    const dir = path.join(resolveSrcDir(), 'grammar')
    const result: Record<string, Example[]> = {}
    let names: string[] = []
    try {
      names = (await readdir(dir)).filter((name) => name.endsWith('.json'))
    } catch {
      return result
    }
    for (const name of names) {
      let parsed: unknown
      try {
        parsed = JSON.parse(await readFile(path.join(dir, name), 'utf8'))
      } catch {
        continue // JSON 合法性由 validate-grammar 把关并报错
      }
      const file = parsed as { grammarId?: unknown; examples?: unknown }
      if (typeof file.grammarId !== 'string' || !Array.isArray(file.examples)) continue
      result[file.grammarId] = file.examples.map((raw) => {
        const ex = raw as Record<string, unknown>
        return {
          id: String(ex.id ?? ''),
          text: String(ex.text ?? ''),
          furigana: Array.isArray(ex.furigana)
            ? ex.furigana.map((part) => {
                const f = part as Record<string, unknown>
                return { text: String(f.text ?? ''), reading: String(f.reading ?? '') }
              })
            : [],
          translation: String(ex.translation ?? ''),
          audio: typeof ex.audio === 'string' ? ex.audio : null,
        }
      })
    }
    return result
  },
}
