import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Kbd } from '@superone/ui/components/ui/kbd'
import { cn } from '@superone/ui/lib/utils'
import type {
  QuestionAnnotations,
  QuestionPreviewFormat,
  UserQuestion,
} from '@superone/shared/agent-types'
import {
  hasPreviewOptions,
  OptionDescriptionCallout,
  QuestionPreviewBox,
  questionKey,
  QuestionTabs,
  selectedOptionLabels,
  type RenderQuestionPreview,
} from './AskUserQuestionShared'
import { getStallColor, type StallLevel } from './stall-color'
import { ToolBrandIcon } from './ToolIcon'
import { ToolName } from './ToolRow'
import { getToolDisplay, getToolVerb } from './tool-display'
import { parseQAPairs } from './tool-block-utils'

export interface AnsweredQuestion {
  question: string
  answer: string
  preview?: string
}

export function isAskUserQuestionDismissed(result?: string, isDenied?: boolean): boolean {
  return !!result && (!!isDenied || result.includes('dismissed'))
}

function parseFallbackQAPairs(text: string): Array<{ question: string; answer: string }> {
  const quoted = parseQAPairs(text)
  if (quoted.length > 0) return quoted
  const pairs: Array<{ question: string; answer: string }> = []
  const regex = /(?:^|\n)Q:\s*(.+)\nA:\s*(.+)/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    pairs.push({ question: match[1].trim(), answer: match[2].trim() })
  }
  return pairs
}

export function extractAnsweredQuestions(params: Record<string, unknown>): AnsweredQuestion[] | null {
  const questions = params.questions
  const answers = params.answers
  if (!Array.isArray(questions) || typeof answers !== 'object' || answers === null) return null
  const annotations = (params.annotations && typeof params.annotations === 'object' ? params.annotations : {}) as QuestionAnnotations
  const answerMap = answers as Record<string, string>
  const result: AnsweredQuestion[] = []
  for (const q of questions as UserQuestion[]) {
    const key = questionKey(q)
    const answer = answerMap[key] ?? answerMap[q.question]
    if (!answer) continue
    const annotation = annotations[key] ?? annotations[q.question]
    result.push({ question: q.question, answer, preview: annotation?.preview })
  }
  return result
}

export interface AskUserQuestionResultPresenterProps {
  text: string
  params: Record<string, unknown>
  renderPreview: RenderQuestionPreview
}

export function AskUserQuestionResultPresenter({ text, params, renderPreview }: AskUserQuestionResultPresenterProps) {
  const previewFormat = (typeof params.previewFormat === 'string' ? params.previewFormat : 'markdown') as QuestionPreviewFormat
  const answered: AnsweredQuestion[] = extractAnsweredQuestions(params) ?? parseFallbackQAPairs(text)
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

function QuestionNoteBox({ label, text }: { label: string; text: string }) {
  return (
    <div className="mt-2 flex items-baseline gap-2 rounded bg-muted px-2.5 py-1.5 text-xs text-foreground">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words">{text}</span>
    </div>
  )
}

function StatusBadge({ dismissed }: { dismissed: boolean }) {
  const { t } = useTranslation()
  return (
    <span
      className={cn(
        'shrink-0 rounded px-1.5 py-0.5 text-xs',
        dismissed ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary',
      )}
    >
      {dismissed ? t('chat.toolBlock.dismissed') : t('chat.askUser.answered')}
    </span>
  )
}

export interface AskUserQuestionBlockPresenterProps {
  params: Record<string, unknown>
  result?: string
  toolUseId?: string
  isStreaming: boolean
  isDenied?: boolean
  elapsedSeconds?: number
  stallLevel?: StallLevel
  allowExpand: boolean
  renderPreview: RenderQuestionPreview
}

export function AskUserQuestionBlockPresenter({
  params,
  result,
  toolUseId,
  isStreaming,
  isDenied,
  elapsedSeconds,
  stallLevel = 'normal',
  allowExpand,
  renderPreview,
}: AskUserQuestionBlockPresenterProps) {
  const { t } = useTranslation()
  const isDismissed = isAskUserQuestionDismissed(result, isDenied)
  const display = useMemo(() => getToolDisplay('AskUserQuestion', params, '', ''), [params])

  const questions = useMemo(() => {
    if (!Array.isArray(params.questions)) return []
    return (params.questions as unknown[]).filter(
      (q): q is UserQuestion => Boolean(q && typeof q === 'object' && typeof (q as UserQuestion).question === 'string' && (q as UserQuestion).question.length > 0),
    )
  }, [params.questions])

  const answerMap = useMemo(
    () => (params.answers && typeof params.answers === 'object' && !Array.isArray(params.answers)
      ? (params.answers as Record<string, string>)
      : {}),
    [params.answers],
  )
  const annotations = useMemo(
    () => (params.annotations && typeof params.annotations === 'object' && !Array.isArray(params.annotations)
      ? (params.annotations as QuestionAnnotations)
      : {}),
    [params.annotations],
  )
  const qaPairs = useMemo(() => (result ? parseFallbackQAPairs(result) : []), [result])
  const qaPairMap = useMemo(() => new Map(qaPairs.map((pair) => [pair.question, pair.answer])), [qaPairs])

  const [activeTab, setActiveTab] = useState(0)
  const [inspectedByTab, setInspectedByTab] = useState<Record<number, string | null>>({})

  if (!allowExpand || isStreaming) {
    return (
      <div
        data-tool-use-id={toolUseId}
        className="tool-node my-0.5 flex min-w-0 items-center gap-1.5 rounded bg-muted/20 px-2 py-1.5 text-xs"
      >
        <ToolBrandIcon alt="" icon="message-circle" />
        <ToolName streaming={isStreaming}>
          {isStreaming ? <>{getToolVerb('AskUserQuestion')}…</> : `Asked${display.summary ? ` ${display.summary}` : ''}`}
        </ToolName>
        {!isStreaming && isDismissed && (
          <span className="shrink-0 rounded bg-muted px-1 py-px text-xs text-muted-foreground">
            {t('chat.toolBlock.dismissed')}
          </span>
        )}
        {isStreaming && elapsedSeconds != null && elapsedSeconds >= 1 && (
          <span className={cn('ml-auto shrink-0 transition-colors duration-500', getStallColor(stallLevel))}>
            {Math.round(elapsedSeconds)}s
          </span>
        )}
      </div>
    )
  }

  const previewFormat = (typeof params.previewFormat === 'string' ? params.previewFormat : 'markdown') as QuestionPreviewFormat

  if (questions.length === 0) {
    if (qaPairs.length === 0) {
      return (
        <div
          data-tool-use-id={toolUseId}
          data-ask-user-question-result={toolUseId}
          className="@container my-0.5 flex min-w-0 items-center justify-between gap-2 rounded-lg border border-border/60 bg-card p-3 text-xs"
        >
          <div className="flex min-w-0 items-center gap-1.5">
            <ToolBrandIcon alt="" icon="message-circle" />
            <span className="font-medium text-foreground">
              {`Asked${display.summary ? ` ${display.summary}` : ''}`}
            </span>
          </div>
          <StatusBadge dismissed={isDismissed} />
        </div>
      )
    }

    const safeTab = Math.min(activeTab, qaPairs.length - 1)
    const activePair = qaPairs[safeTab]
    const fallbackQuestions: UserQuestion[] = qaPairs.map((pair) => ({
      question: pair.question,
      header: pair.question,
      options: [],
      multiSelect: false,
    }))

    return (
      <div
        data-tool-use-id={toolUseId}
        data-ask-user-question-result={toolUseId}
        className="@container my-0.5 flex min-w-0 flex-col rounded-lg border border-primary/30 bg-card p-3"
      >
        {qaPairs.length > 1 ? (
          <QuestionTabs
            questions={fallbackQuestions}
            activeTab={safeTab}
            onSelectTab={setActiveTab}
            isTabAnswered={(_q, idx) => Boolean(qaPairs[idx]?.answer)}
            trailing={<StatusBadge dismissed={false} />}
          />
        ) : null}
        <div className="mb-2 flex items-start justify-between gap-2">
          <p className="text-xs font-medium text-foreground">{activePair.question}</p>
          {qaPairs.length === 1 && <StatusBadge dismissed={false} />}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <span className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground">
            {activePair.answer}
          </span>
        </div>
      </div>
    )
  }

  const safeTab = Math.min(activeTab, questions.length - 1)
  const activeQuestion = questions[safeTab]
  const options = Array.isArray(activeQuestion.options) ? activeQuestion.options : []
  const qKey = questionKey(activeQuestion)
  const answerStr = isDismissed
    ? ''
    : (answerMap[qKey] ?? answerMap[activeQuestion.question] ?? qaPairMap.get(activeQuestion.question) ?? '')
  const annotation = annotations[qKey] ?? annotations[activeQuestion.question]
  const notes = annotation?.notes?.trim() ?? ''

  const rawSelected = selectedOptionLabels(answerStr, activeQuestion.multiSelect)
  const selectedLabels = rawSelected.filter((label) => options.some((opt) => opt.label === label))
  const otherText = answerStr.trim() && selectedLabels.length === 0 ? answerStr : ''

  const isPreview = hasPreviewOptions(activeQuestion) || Boolean(annotation?.preview)
  const isHtml = previewFormat === 'html'
  const inspectedLabel = inspectedByTab[safeTab] ?? null
  const inspectedOpt = inspectedLabel ? options.find((o) => o.label === inspectedLabel) ?? null : null
  const isInspectingUnselected = Boolean(inspectedOpt && !selectedLabels.includes(inspectedOpt.label))
  const anyOptionHasDetail = options.some((o) => Boolean(o.description || o.preview))

  const handleOptionClick = (label: string) => {
    if (!anyOptionHasDetail) return
    const isSelected = selectedLabels.includes(label)
    setInspectedByTab((prev) => {
      const current = prev[safeTab] ?? null
      if (isSelected) {
        if (current === label) return { ...prev, [safeTab]: null }
        if (isPreview && selectedLabels.length > 1) return { ...prev, [safeTab]: label }
        return { ...prev, [safeTab]: null }
      }
      return { ...prev, [safeTab]: current === label ? null : label }
    })
  }

  const defaultSelectedPreview = selectedLabels.length > 0
    ? options.find((o) => o.label === selectedLabels[selectedLabels.length - 1])?.preview
    : undefined
  const activePreview = inspectedOpt
    ? inspectedOpt.preview
    : (defaultSelectedPreview ?? annotation?.preview)

  const optionButtons = (
    <div className={cn('flex flex-wrap gap-1.5', isPreview && !isHtml && '@[420px]:flex-col')}>
      {options.map((opt, i) => {
        const isSelected = selectedLabels.includes(opt.label)
        const isInspected = inspectedLabel === opt.label
        return (
          <button
            key={opt.label}
            type="button"
            disabled={!anyOptionHasDetail}
            aria-pressed={isSelected || isInspected}
            data-selected={isSelected ? 'true' : undefined}
            data-inspected={isInspected ? 'true' : undefined}
            onClick={() => handleOptionClick(opt.label)}
            className={cn(
              'rounded px-2 py-1 text-left text-xs whitespace-normal transition',
              anyOptionHasDetail ? 'cursor-pointer' : 'cursor-default',
              isSelected
                ? cn('bg-primary text-primary-foreground', isInspected && 'ring-1 ring-primary-foreground/60')
                : isInspected
                  ? 'bg-accent text-foreground ring-1 ring-primary/60'
                  : cn('bg-muted text-foreground', anyOptionHasDetail && 'hover:bg-accent'),
            )}
          >
            <Kbd variant="square" className="mr-1.5">{i + 1}</Kbd>
            {opt.label}
          </button>
        )
      })}
    </div>
  )

  const descriptionNode = isInspectingUnselected && inspectedOpt ? (
    <OptionDescriptionCallout
      options={options}
      labels={[inspectedOpt.label]}
      multiSelect={activeQuestion.multiSelect}
      tone="inspecting"
    />
  ) : (
    <OptionDescriptionCallout
      options={options}
      labels={inspectedOpt ? [inspectedOpt.label] : selectedLabels}
      multiSelect={activeQuestion.multiSelect}
    />
  )

  return (
    <div
      data-tool-use-id={toolUseId}
      data-ask-user-question-result={toolUseId}
      className={cn(
        '@container my-0.5 flex min-w-0 flex-col rounded-lg border bg-card p-3',
        isDismissed ? 'border-border/60' : 'border-primary/30',
      )}
    >
      {questions.length > 1 && (
        <QuestionTabs
          questions={questions}
          activeTab={safeTab}
          onSelectTab={setActiveTab}
          isTabAnswered={(q) => {
            if (isDismissed) return false
            const key = questionKey(q)
            return Boolean(answerMap[key] ?? answerMap[q.question] ?? qaPairMap.get(q.question))
          }}
          trailing={<StatusBadge dismissed={isDismissed} />}
        />
      )}

      {questions.length === 1 ? (
        <div className="mb-2 flex items-start justify-between gap-2">
          <div className="min-w-0">
            {activeQuestion.header && (
              <span className="mb-0.5 block text-xs text-muted-foreground">{activeQuestion.header}</span>
            )}
            <p className="text-xs font-medium text-foreground">{activeQuestion.question}</p>
          </div>
          <StatusBadge dismissed={isDismissed} />
        </div>
      ) : (
        <p className="mb-2 text-xs font-medium text-foreground">{activeQuestion.question}</p>
      )}

      {isPreview ? (
        <div className={cn('flex flex-col gap-3', !isHtml && '@[420px]:flex-row')}>
          <div className={cn('shrink-0', !isHtml && '@[420px]:max-w-[40%]')}>
            {optionButtons}
            {descriptionNode}
            {otherText && <QuestionNoteBox label={t('chat.askUser.otherLabel')} text={otherText} />}
          </div>
          <div className="min-w-0 flex-1">
            {activePreview ? (
              <QuestionPreviewBox content={activePreview} format={previewFormat} renderPreview={renderPreview} />
            ) : (
              <div className="flex h-full items-center justify-center rounded-md border border-dashed border-border/30 p-3 text-xs text-muted-foreground">
                {t('chat.askUser.selectOptionPreview')}
              </div>
            )}
            {notes && <QuestionNoteBox label={t('chat.askUser.noteLabel')} text={notes} />}
          </div>
        </div>
      ) : (
        <div>
          {optionButtons}
          {descriptionNode}
          {otherText && <QuestionNoteBox label={t('chat.askUser.otherLabel')} text={otherText} />}
          {notes && <QuestionNoteBox label={t('chat.askUser.noteLabel')} text={notes} />}
        </div>
      )}
    </div>
  )
}
