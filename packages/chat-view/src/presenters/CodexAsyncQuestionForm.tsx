import { useRef, useState } from 'react'
import type { CodexAsyncUserInputQuestion } from '@superone/shared/agent-types'
import { formatCodexAsyncQuestionReply } from '@superone/shared/codex-async-question'
import { CodexAsyncQuestionView } from './CodexAsyncQuestionView'

/** Both hosts acknowledge a reply before the card enters its answered state. Key by item id. */
export function CodexAsyncQuestionForm({ questions, submittedReply, disabled, onSubmit }: {
  questions: CodexAsyncUserInputQuestion[]
  submittedReply: string | null
  disabled?: boolean
  onSubmit: (answers: string[]) => Promise<void>
}) {
  const [answers, setAnswers] = useState(() => questions.map(question => question.options?.[0] ?? ''))
  const [localReply, setLocalReply] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pending = useRef(false)
  const reply = submittedReply ?? localReply
  const canSubmit = !disabled && questions.length > 0 && answers.length === questions.length && answers.every(answer => answer.trim())
  const submit = async () => {
    if (!canSubmit || pending.current || reply !== null) return
    pending.current = true
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit(answers)
      setLocalReply(formatCodexAsyncQuestionReply(questions, answers))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      pending.current = false
      setSubmitting(false)
    }
  }
  return <CodexAsyncQuestionView questions={questions} answers={answers} submitting={submitting}
    submittedReply={reply} error={error} canSubmit={canSubmit}
    onAnswerChange={(index, answer) => setAnswers(current => current.map((value, i) => i === index ? answer : value))}
    onSubmit={() => void submit()} />
}
