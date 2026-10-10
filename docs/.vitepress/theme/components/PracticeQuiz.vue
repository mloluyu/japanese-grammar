<script setup lang="ts">
import { computed, ref } from 'vue'
import { useData } from 'vitepress'
import { data as questions } from '../../../quizzes.data'

// 条目内练习（M4 范围调整：不做独立练习页与抽题）。
// 按当前条目 ID 过滤 grammarIds 命中的题目；选择后即时反馈并展开解析。
// 作答状态仅存于会话内存，不做本地持久化（ADR-0004）。
// 折叠状态同样是会话内 ref；练习默认折叠（Issue #1 F10），展开后作答。

interface Question {
  id: string
  grammarIds: string[]
  prompt: string
  options: string[]
  answer: number
  explanation: string
  difficulty?: number
}

const { frontmatter } = useData()

const entryQuestions = computed<Question[]>(() => {
  const id = String(frontmatter.value.id ?? '')
  if (!id) return []
  return questions.filter((q) => q.grammarIds.includes(id))
})

// 练习块默认折叠，点击标题右侧按钮展开/收起。
const expanded = ref(false)

// answers[题目id] = 已选选项下标；未作答的题目不出现在对象里。
const answers = ref<Record<string, number>>({})

function select(question: Question, index: number) {
  if (answers.value[question.id] !== undefined) return
  answers.value = { ...answers.value, [question.id]: index }
}

function reset() {
  answers.value = {}
}

const answeredCount = computed(
  () => entryQuestions.value.filter((q) => answers.value[q.id] !== undefined).length,
)

const resultLabel = computed(() => {
  const answered = entryQuestions.value.filter((q) => answers.value[q.id] !== undefined)
  if (answered.length === 0) return ''
  const correct = answered.filter((q) => answers.value[q.id] === q.answer).length
  return `${correct} / ${answered.length} 正确`
})
</script>

<template>
  <section v-if="entryQuestions.length > 0" class="practice-quiz">
    <div class="quiz-header">
      <h2>小练习</h2>
      <span class="quiz-progress" role="status">
        {{ answeredCount > 0 ? `${resultLabel} · ` : '' }}共 {{ entryQuestions.length }} 题
      </span>
      <button
        v-if="answeredCount > 0"
        type="button"
        class="quiz-reset"
        @click="reset"
      >
        重做
      </button>
      <button
        type="button"
        class="quiz-toggle"
        :aria-expanded="expanded"
        aria-controls="practice-quiz-list"
        @click="expanded = !expanded"
      >
        {{ expanded ? '收起' : '展开' }}
      </button>
    </div>

    <ol v-show="expanded" id="practice-quiz-list" class="question-list">
      <li v-for="question in entryQuestions" :key="question.id" class="question">
        <p class="prompt" lang="ja">{{ question.prompt }}</p>
        <div class="options">
          <button
            v-for="(option, index) in question.options"
            :key="index"
            type="button"
            class="option"
            :class="{
              'is-correct': answers[question.id] !== undefined && index === question.answer,
              'is-wrong':
                answers[question.id] === index && index !== question.answer,
              'is-dimmed': answers[question.id] !== undefined && index !== question.answer && answers[question.id] !== index,
            }"
            :disabled="answers[question.id] !== undefined"
            @click="select(question, index)"
          >
            {{ option }}
          </button>
        </div>
        <p
          v-if="answers[question.id] !== undefined"
          class="feedback"
          :class="answers[question.id] === question.answer ? 'is-correct' : 'is-wrong'"
          aria-live="polite"
        >
          {{ answers[question.id] === question.answer ? '✓ 正确' : '✗ 不对' }}——{{ question.explanation }}
        </p>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.practice-quiz {
  margin-top: 32px;
  padding-top: 20px;
  border-top: 1px solid var(--vp-c-divider);
}
.quiz-header {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
}
.quiz-header h2 {
  font-size: 18px;
  margin: 0;
}
.quiz-progress {
  font-size: 13px;
  color: var(--vp-c-text-2);
}
.quiz-reset {
  border: 1px solid var(--vp-c-border);
  border-radius: 8px;
  padding: 2px 10px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  cursor: pointer;
  font-size: 13px;
}
.quiz-reset:hover,
.quiz-toggle:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}
.quiz-toggle {
  border: 1px solid var(--vp-c-border);
  border-radius: 8px;
  padding: 2px 10px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  cursor: pointer;
  font-size: 13px;
  margin-left: auto;
}
.question-list {
  list-style: none;
  margin: 12px 0 0;
  padding: 0;
  display: grid;
  gap: 18px;
}
.question {
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  padding: 12px 16px;
  background: var(--vp-c-bg-soft);
}
.prompt {
  margin: 0 0 10px;
  font-size: 16px;
  line-height: 1.9;
}
.options {
  display: grid;
  gap: 8px;
}
.option {
  text-align: left;
  border: 1px solid var(--vp-c-border);
  border-radius: 8px;
  padding: 8px 12px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  cursor: pointer;
  font-size: 15px;
  line-height: 1.6;
}
.option:hover:not(:disabled) {
  border-color: var(--vp-c-brand-1);
}
.option:disabled {
  cursor: default;
}
.option.is-correct {
  border-color: var(--vp-c-green-1, #3ca36c);
  background: var(--vp-c-green-soft, rgba(60, 163, 108, 0.14));
}
.option.is-wrong {
  border-color: var(--vp-c-red-1, #e65562);
  background: var(--vp-c-red-soft, rgba(230, 85, 98, 0.14));
}
.option.is-dimmed {
  opacity: 0.6;
}
.feedback {
  margin: 10px 0 0;
  font-size: 14px;
  line-height: 1.7;
}
.feedback.is-correct {
  color: var(--vp-c-green-1, #3ca36c);
}
.feedback.is-wrong {
  color: var(--vp-c-red-1, #e65562);
}
</style>
