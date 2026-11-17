import type { ReactNode, RefObject } from 'react'
import { AutoResizeTextarea } from '@superone/ui/components/ui/auto-resize-textarea'
import { Kbd } from '@superone/ui/components/ui/kbd'
import { cn } from '@superone/ui/lib/utils'
import type { QuestionPreviewFormat, UserQuestion, UserQuestionOption } from '@superone/shared/agent-types'

export type RenderQuestionPreview = (props: { content: string; format: QuestionPreviewFormat }) => ReactNode

export function questionKey(q: Pick<UserQuestion, 'id' | 'question'>): string {
  return q.id ?? q.question
}

export function hasPreviewOptions(q: Pick<UserQuestion, 'options'>): boolean {
  return Array.isArray(q.options) && q.options.some((o) => !!o.preview)
}

export function selectedOptionLabels(selection: string | undefined, multiSelect: boolean): string[] {
  if (!selection) return []
  return multiSelect ? selection.split(', ').filter(Boolean) : [selection]
}

export function QuestionTabs({
  questions,
  activeTab,
  onSelectTab,
  isTabAnswered,
  trailing,
}: {
  questions: readonly UserQuestion[]
  activeTab: number
  onSelectTab: (index: number) => void
  isTabAnswered: (q: UserQuestion, index: number) => boolean
  trailing?: ReactNode
}) {
  return (
    <div className="mb-3 flex shrink-0 items-center justify-between gap-2 border-b border-border/50 pb-2">
      <div className="flex min-w-0 gap-1 overflow-x-auto">
        {questions.map((q, i) => (
          <button
            key={questionKey(q)}
            type="button"
            title={q.header || q.question}
            aria-label={`Q${i + 1}: ${q.question}`}
            aria-pressed={activeTab === i}
            onClick={() => onSelectTab(i)}
            className={cn(
              'relative shrink-0 cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium transition',
              activeTab === i ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {`Q${i + 1}`}
            {isTabAnswered(q, i) && <span className="ml-1 text-xs text-green-500">&#10003;</span>}
          </button>
        ))}
      </div>
      {trailing}
    </div>
  )
}

export function OptionDescriptionCallout({
  options,
  labels,
  multiSelect,
  tone = 'selected',
}: {
  options: readonly UserQuestionOption[]
  labels: readonly string[]
  multiSelect: boolean
  tone?: 'selected' | 'inspecting'
}) {
  if (labels.length === 0) return null
  const described = options.filter((o) => labels.includes(o.label) && o.description)
  if (described.length === 0) return null
  const showLabel = tone === 'inspecting' || (multiSelect && labels.length > 1)
  return (
    <div
      className={cn(
        'mt-2 space-y-1 border-l-2 px-2.5 py-1.5 text-xs leading-snug',
        tone === 'inspecting'
          ? 'border-border bg-muted/60 text-muted-foreground'
          : 'border-primary bg-primary/10 text-primary',
      )}
    >
      {described.map((opt) => (
        <div key={opt.label}>
          {showLabel && (
            <span className={cn('mr-1.5 font-medium', tone === 'inspecting' && 'text-foreground')}>
              {opt.label}:
            </span>
          )}
          <span>{opt.description}</span>
        </div>
      ))}
    </div>
  )
}

export function QuestionPreviewBox({
  content,
  format,
  renderPreview,
}: {
  content: string
  format: QuestionPreviewFormat
  renderPreview: RenderQuestionPreview
}) {
  return (
    <div
      className={cn(
        'overflow-y-auto rounded-md border border-border/50 text-xs',
        format === 'html' ? 'max-h-[28rem] bg-transparent p-0' : 'max-h-64 bg-muted/30 p-3',
      )}
    >
      {renderPreview({ content, format })}
    </div>
  )
}

export function isOptionSelected(q: UserQuestion, selections: Record<string, string>, label: string): boolean {
  const sel = selections[questionKey(q)] ?? ''
  return q.multiSelect ? sel.split(', ').includes(label) : sel === label
}

export function selectedOptionPreview(q: UserQuestion, selections: Record<string, string>): string | null {
  const sel = selections[questionKey(q)]
  if (!sel) return null
  const label = q.multiSelect ? sel.split(', ').at(-1) : sel
  return q.options.find((o) => o.label === label)?.preview ?? null
}

export function OptionButtons({
  q,
  selections,
  onSelect,
  keys,
  className,
}: {
  q: UserQuestion
  selections: Record<string, string>
  onSelect: (q: UserQuestion, label: string) => void
  keys: boolean
  className: string
}) {
  return (
    <div className={className}>
      {q.options.map((opt, i) => (
        <button
          key={opt.label}
          type="button"
          onClick={() => onSelect(q, opt.label)}
          className={cn(
            'cursor-pointer rounded text-left whitespace-normal transition',
            keys ? 'px-2 py-1 text-xs' : 'px-3 py-2 text-sm',
            isOptionSelected(q, selections, opt.label)
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-foreground hover:bg-accent',
          )}
        >
          {keys && <Kbd variant="square" className="mr-1.5">{i + 1}</Kbd>}
          {opt.label}
        </button>
      ))}
    </div>
  )
}

const INPUT = 'w-full rounded border-0 bg-muted pr-2 text-foreground shadow-none placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring'

export function KeyedInput({
  keys,
  shortcut,
  inputRef,
  ...props
}: {
  keys: boolean
  shortcut?: ReactNode
  inputRef: RefObject<HTMLTextAreaElement | null>
  placeholder: string
  value: string
  onChange: (value: string) => void
  onFocus?: () => void
  onBlur?: () => void
  onSubmit?: () => void
}) {
  return (
    <div className="relative mt-2">
      {shortcut != null && (
        <Kbd variant="square" className="pointer-events-none absolute left-2 top-1.5">{shortcut}</Kbd>
      )}
      <AutoResizeTextarea
        ref={inputRef}
        placeholder={props.placeholder}
        aria-label={props.placeholder}
        value={props.value}
        onValueChange={props.onChange}
        onSubmit={keys ? props.onSubmit : undefined}
        onFocus={props.onFocus}
        onBlur={props.onBlur}
        className={cn(
          INPUT,
          keys ? 'min-h-7 py-1.5 text-xs leading-4' : 'py-2 text-sm',
          shortcut != null ? 'pl-[30px]' : keys ? 'pl-2' : 'pl-3',
        )}
      />
    </div>
  )
}
