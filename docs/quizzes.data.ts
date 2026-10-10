import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

// 题库数据加载器：构建时读取 content/quizzes/*.json 并展平为题目列表。
// 题目通过 grammarIds 与语法条目关联，练习组件按当前条目 ID 过滤。
// 文件格式与校验规则见 project-docs/CONTENT_SCHEMA.md 第 4 节。

export interface QuizQuestion {
  id: string
  type: string
  grammarIds: string[]
  prompt: string
  options: string[]
  answer: number
  explanation: string
  difficulty?: number
}

declare const data: QuizQuestion[]
export { data }

// 题库数据目录固定在仓库根 content/（npm scripts 与 CI 均从仓库根执行）。
function contentDir(): string {
  return path.resolve(process.cwd(), 'content')
}

export default {
  async load(): Promise<QuizQuestion[]> {
    const dir = path.join(contentDir(), 'quizzes')
    const questions: QuizQuestion[] = []
    let names: string[] = []
    try {
      names = (await readdir(dir)).filter((name) => name.endsWith('.json')).sort()
    } catch {
      return questions
    }
    for (const name of names) {
      let parsed: unknown
      try {
        parsed = JSON.parse(await readFile(path.join(dir, name), 'utf8'))
      } catch {
        continue // JSON 合法性由 validate-quiz 把关并报错
      }
      const bank = parsed as { questions?: unknown }
      if (!Array.isArray(bank.questions)) continue
      for (const raw of bank.questions) {
        const q = raw as Record<string, unknown>
        if (q.type !== 'single-choice') continue
        questions.push({
          id: String(q.id ?? ''),
          type: 'single-choice',
          grammarIds: Array.isArray(q.grammarIds) ? q.grammarIds.map(String) : [],
          prompt: String(q.prompt ?? ''),
          options: Array.isArray(q.options) ? q.options.map(String) : [],
          answer: typeof q.answer === 'number' ? q.answer : -1,
          explanation: String(q.explanation ?? ''),
          difficulty: typeof q.difficulty === 'number' ? q.difficulty : undefined,
        })
      }
    }
    return questions
  },
}
