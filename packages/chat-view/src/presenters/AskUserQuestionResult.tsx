import type { ReactNode } from 'react'
import { cn } from '@superone/ui/lib/utils'
import { parseQAPairs } from './tool-block-utils'
import type { QuestionAnnotations, QuestionPreviewFormat, UserQuestion } from '@superone/shared/agent-types'

export interface AnsweredQuestion {
  question: string
  answer: string
  preview?: string
}

/**
 * Answers ride along in the tool input on the desktop, where the full call is kept.
 * The phone gets a count-only projection of `questions`, so this returns null there and
 * the caller falls back to parsing the transcript text — which both surfaces receive.
 */
export function extractAnsweredQuestions(params: Record<string, unknown>): AnsweredQuestion[] | null {
  const questions = params.questions
  const answers = params.answers
  if (!Array.isArray(questions) || typeof answers !== 'object' || answers === null) return null
  const annotations = (params.annotations && typeof params.annotations === 'object' ? params.annotations : {}) as QuestionAnnotations
  const answerMap = answers as Record<string, string>
  const result: AnsweredQuestion[] = []
  for (const q of questions as UserQuestion[]) {
    const answer = answerMap[q.question]
    if (!answer) continue
    result.push({ question: q.question, answer, preview: annotations[q.question]?.preview })
  }
  return result
}

export interface AskUserQuestionResultPresenterProps {
  text: string
  params: Record<string, unknown>
  /** Host-provided preview body: sanitized HTML on the desktop, markdown in the WebView. */
  renderPreview: (props: { content: string; format: QuestionPreviewFormat }) => ReactNode
}

/** AskUserQuestion result as Q&A pairs, with the selected option's preview inline. */
export function AskUserQuestionResultPresenter({ text, params, renderPreview }: AskUserQuestionResultPresenterProps) {
  const previewFormat = (typeof params.previewFormat === 'string' ? params.previewFormat : 'markdown') as QuestionPreviewFormat
  const answered: AnsweredQuestion[] = extractAnsweredQuestions(params) ?? parseQAPairs(text)
  if (answered.length === 0) return null

  return (
    <div className="space-y-1">
      {answered.map((qa, i) => (
        <div key={i} className="rounded bg-background/70 px-2 py-1.5 text-xs leading-relaxed">
          <div className="text-muted-foreground">{qa.question}</div>
          <div className="text-success">{qa.answer}</div>
          {qa.preview && (
            <div
              className={cn(
                'mt-1.5 overflow-y-auto rounded-md border border-border/50 text-xs',
                previewFormat === 'html' ? 'max-h-[28rem] bg-transparent p-0' : 'max-h-64 bg-muted/30 p-2',
              )}
            >
              {renderPreview({ content: qa.preview, format: previewFormat })}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
