import { useTranslation } from 'react-i18next'
import { Check, Send } from 'lucide-react'
import type { CodexAsyncUserInputQuestion } from '@superone/shared/agent-types'
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
    return (
      <div className="my-2 flex flex-col gap-2 rounded-lg border border-border/70 bg-muted/20 p-3">
        <Badge variant="outline" role="status" className="border-success/25 bg-success/10 text-success">
          <Check />
          {t('chat.askUser.answered')}
        </Badge>
        {questions.length === 1 && <div className="text-sm font-medium">{questions[0].title}</div>}
        <div className="whitespace-pre-wrap text-sm">{submittedReply}</div>
      </div>
    )
  }

  return (
    <div className="my-2 flex flex-col gap-3 rounded-lg border border-border/70 bg-muted/20 p-3">
      {questions.map((question, questionIndex) => (
        <fieldset key={questionIndex} disabled={disabled || submitting} className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-foreground">{question.title}</legend>
          {question.options && (
            <div className="flex flex-wrap gap-1.5">
              {question.options.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={answers[questionIndex] === option}
                  onClick={() => onAnswerChange(questionIndex, option)}
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
  )
}
