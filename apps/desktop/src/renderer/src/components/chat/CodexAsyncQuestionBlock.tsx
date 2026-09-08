import { useCallback, useMemo, useRef, useState } from 'react'
import type { CodexAgentMessageItem, CodexAsyncUserInputQuestion } from '@superone/shared/agent-types'
import { CodexAsyncQuestionView } from './CodexAsyncQuestionView'
import { steerAsyncQuestionAnswer } from './codex-async-question-answer'
import { useActiveSession, useChatStore, useSessionScope } from '@/stores/chat'

function defaultAnswers(questions: CodexAsyncUserInputQuestion[]): string[] {
  return questions.map((question) => question.options?.[0] ?? '')
}

export function formatCodexAsyncQuestionReply(
  questions: CodexAsyncUserInputQuestion[],
  answers: string[],
): string {
  if (questions.length === 1) return answers[0]?.trim() ?? ''
  return questions
    .map((question, index) => `${question.title}\n${answers[index]?.trim() ?? ''}`)
    .join('\n\n')
}

export function CodexAsyncQuestionBlock({ item }: { item: CodexAgentMessageItem }) {
  const scope = useSessionScope()
  const projectPath = useChatStore((state) => scope?.projectPath ?? state.activeProject)
  const sessionId = useActiveSession((session) => scope?.sessionId ?? session._activeSessionId)
  const questions = item.questions ?? []
  const initialAnswers = useMemo(() => defaultAnswers(questions), [questions])
  const [answers, setAnswers] = useState(initialAnswers)
  const replyId = `codex_async_answer:${item.id}`
  const savedReply = useActiveSession((session) => session.messages.find((message) => message.id === replyId))
  const [submitting, setSubmitting] = useState(false)
  const pending = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const submittedReply = savedReply?.content.flatMap((block) => block.type === 'text' ? [block.text] : []).join('\n') ?? null
  const canSubmit = questions.length > 0 && answers.every((answer) => answer.trim().length > 0)

  const updateAnswer = useCallback((index: number, answer: string) => {
    setAnswers((current) => current.map((value, answerIndex) => answerIndex === index ? answer : value))
  }, [])

  const submit = useCallback(async () => {
    if (!canSubmit || submittedReply !== null || pending.current || !sessionId || !projectPath) return
    const reply = formatCodexAsyncQuestionReply(questions, answers)
    if (!reply) return
    pending.current = true
    setSubmitting(true)
    setError(null)
    try {
      await steerAsyncQuestionAnswer({ projectPath, sessionId }, replyId, reply)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      pending.current = false
      setSubmitting(false)
    }
  }, [answers, canSubmit, questions, replyId, projectPath, sessionId, submittedReply])

  return (
    <CodexAsyncQuestionView
      questions={questions}
      answers={answers}
      submitting={submitting}
      submittedReply={submittedReply}
      error={error}
      canSubmit={canSubmit && Boolean(sessionId && projectPath)}
      onAnswerChange={updateAnswer}
      onSubmit={submit}
    />
  )
}
