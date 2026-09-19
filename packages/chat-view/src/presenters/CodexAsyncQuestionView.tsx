import { useTranslation } from 'react-i18next'
import { Check, Send, UserRound } from 'lucide-react'
import type { CodexAsyncUserInputQuestion } from '@superone/shared/agent-types'
import { parseCodexAsyncQuestionReply } from '@superone/shared/codex-async-question'
import { Badge } from '@superone/ui/components/ui/badge'
import { Button } from '@superone/ui/components/ui/button'
import { cn } from '@superone/ui/lib/utils'

export interface CodexAsyncQuestionViewProps {
  questions: CodexAsyncUserInputQuestion[]
  answers: string[]
  submitting: boolean
  submittedReply: string | null
  error: string | null
  canSubmit: boolean
  disabled?: boolean
  onAnswerChange: (index: number, answer: string) => void
  onSubmit: () => void
}

export function CodexAsyncQuestionView({
  questions, answers, submitting, submittedReply, error, canSubmit, disabled, onAnswerChange, onSubmit,
}: CodexAsyncQuestionViewProps) {
  const { t } = useTranslation()
  if (submittedReply !== null) {
    const submittedAnswers = parseCodexAsyncQuestionReply(questions, submittedReply)
    const pairs = submittedAnswers
      ? questions.map((question, index) => ({ question: question.title, answer: submittedAnswers[index] }))
      : [{ question: questions.map(question => question.title).join('\n\n'), answer: submittedReply }]
    return (
      <div className="my-2 flex min-w-0 flex-col gap-2 overflow-hidden rounded-lg border border-border/70 bg-background p-3">
        <Badge variant="outline" role="status" className="border-success/25 bg-success/10 text-success">
          <Check aria-hidden="true" />
          {t('chat.askUser.answered')}
        </Badge>
        <dl className="flex flex-col gap-4">
          {pairs.map((pair, index) => (
            <div key={index} className="flex min-w-0 flex-col gap-2">
              <dt className="whitespace-pre-wrap text-sm font-medium leading-relaxed text-foreground [overflow-wrap:anywhere]">{pair.question}</dt>
              <dd className="flex flex-col gap-1.5 rounded-md bg-muted/60 px-3 py-2.5">
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <UserRound aria-hidden="true" className="size-3.5" />
                  {t('chat.askUser.yourAnswer')}
                </span>
                <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground [overflow-wrap:anywhere]">{pair.answer}</div>
              </dd>
            </div>
          ))}
        </dl>
      </div>
    )
  }

  return (
    <div className="my-2 min-w-0 overflow-hidden rounded-lg border border-border/70 bg-background">
      <div className="flex flex-col gap-4 p-3">
        {questions.map((question, questionIndex) => (
          <fieldset key={questionIndex} disabled={disabled || submitting} className="flex min-w-0 flex-col gap-2.5">
            <legend className="mb-2.5 whitespace-pre-wrap text-sm font-medium leading-relaxed text-foreground [overflow-wrap:anywhere]">{question.title}</legend>
            {question.options && (
              <div className="flex flex-wrap gap-1.5">
                {question.options.map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={answers[questionIndex] === option}
                    onClick={() => onAnswerChange(questionIndex, option)}
                    className={cn(
                      'flex max-w-full items-start gap-2 rounded-md border px-2.5 py-2 text-left text-xs leading-relaxed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
                      answers[questionIndex] === option
                        ? 'border-primary bg-primary/10 text-foreground'
                        : 'border-border bg-background text-muted-foreground enabled:hover:bg-muted enabled:hover:text-foreground',
                    )}
                  >
                    <span aria-hidden="true" className={cn('mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-full border', answers[questionIndex] === option ? 'border-primary bg-primary text-primary-foreground' : 'border-border')}>
                      {answers[questionIndex] === option && <Check className="size-2.5" />}
                    </span>
                    <span className="min-w-0 [overflow-wrap:anywhere]">{option}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2">
              <input
                aria-label={question.title}
                type="text"
                value={question.options?.includes(answers[questionIndex] ?? '') ? '' : (answers[questionIndex] ?? '')}
                onChange={(event) => onAnswerChange(questionIndex, event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.nativeEvent.isComposing && canSubmit && !disabled && !submitting) onSubmit()
                }}
                placeholder={t('chat.askUser.otherOption')}
                className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
              {questionIndex === questions.length - 1 && (
                <Button size="sm" disabled={!canSubmit || submitting} onClick={onSubmit} className="shrink-0">
                  <Send data-icon="inline-start" />
                  {t('chat.askUser.submit')}
                </Button>
              )}
            </div>
          </fieldset>
        ))}
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      </div>
    </div>
  )
}
