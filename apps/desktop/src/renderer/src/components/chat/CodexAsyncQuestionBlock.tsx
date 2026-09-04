import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Send } from 'lucide-react'
import type { CodexAgentMessageItem, CodexAsyncUserInputQuestion } from '@superone/shared/agent-types'
import { Button } from '@superone/ui/components/ui/button'
import { cn } from '@superone/ui/lib/utils'
import { useChatStore, useSessionScope } from '@/stores/chat'

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
  const { t } = useTranslation()
  const rawSendMessage = useChatStore((state) => state.sendMessage)
  const scope = useSessionScope()
  const questions = item.questions ?? []
  const initialAnswers = useMemo(() => defaultAnswers(questions), [questions])
  const [answers, setAnswers] = useState(initialAnswers)
  const [submitted, setSubmitted] = useState(false)
  const canSubmit = questions.length > 0 && answers.every((answer) => answer.trim().length > 0)

  const updateAnswer = useCallback((index: number, answer: string) => {
    setAnswers((current) => current.map((value, answerIndex) => answerIndex === index ? answer : value))
  }, [])

  const submit = useCallback(() => {
    if (!canSubmit || submitted) return
    const reply = formatCodexAsyncQuestionReply(questions, answers)
    if (!reply) return
    setSubmitted(true)
    void rawSendMessage(reply, undefined, undefined, undefined, scope ?? undefined).catch(() => {
      setSubmitted(false)
    })
  }, [answers, canSubmit, questions, rawSendMessage, scope, submitted])

  return (
    <div className="my-2 space-y-3 rounded-lg border border-border/70 bg-muted/20 p-3">
      {questions.map((question, questionIndex) => (
        <fieldset key={`${item.id}-${questionIndex}`} disabled={submitted} className="space-y-2">
          <legend className="text-sm font-medium text-foreground">{question.title}</legend>
          {question.options && (
            <div className="flex flex-wrap gap-1.5">
              {question.options.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={answers[questionIndex] === option}
                  onClick={() => updateAnswer(questionIndex, option)}
                  className={cn(
                    'rounded-md border px-2.5 py-1.5 text-xs transition-colors',
                    answers[questionIndex] === option
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  {option}
                </button>
              ))}
            </div>
          )}
          <input
            type="text"
            value={question.options?.includes(answers[questionIndex] ?? '') ? '' : (answers[questionIndex] ?? '')}
            onChange={(event) => updateAnswer(questionIndex, event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && canSubmit) submit()
            }}
            placeholder={t('chat.askUser.otherOption')}
            className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </fieldset>
      ))}
      <div className="flex justify-end">
        <Button size="sm" disabled={!canSubmit || submitted} onClick={submit} className="h-7 gap-1.5 px-2.5 text-xs">
          <Send className="size-3" />
          {submitted ? t('chat.askUser.submitted') : t('chat.askUser.submit')}
        </Button>
      </div>
    </div>
  )
}
