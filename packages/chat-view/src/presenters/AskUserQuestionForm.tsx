import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@superone/ui/components/ui/button'
import { Kbd } from '@superone/ui/components/ui/kbd'
import { AutoResizeTextarea } from '@superone/ui/components/ui/auto-resize-textarea'
import { cn } from '@superone/ui/lib/utils'
import type { AskUserQuestionRequest, QuestionAnnotations, QuestionPreviewFormat, UserQuestion } from '@superone/shared/agent-types'

type RenderPreview = (props: { content: string; format: QuestionPreviewFormat }) => ReactNode

export interface AskUserQuestionFormProps {
  request: AskUserQuestionRequest
  onSubmit: (answers: Record<string, string>, annotations?: QuestionAnnotations) => void
  onDismiss: () => void
  /** Host-provided preview body: sanitized HTML on the desktop, a sandboxed frame in the WebView. */
  renderPreview: RenderPreview
  /**
   * Digit, Tab, Enter and Escape shortcuts with their hints, for hosts with a
   * keyboard. `inScope` says whether a key belongs to this form. A touch host
   * omits it and gets a Dismiss button instead.
   */
  keyboard?: { inScope: (event?: KeyboardEvent) => boolean }
}

function questionKey(q: UserQuestion): string {
  return q.question
}

function notesKey(q: UserQuestion, optionLabel: string): string {
  return `${q.question}\0${optionLabel}`
}

function hasPreviewOptions(q: UserQuestion): boolean {
  return q.options.some((o) => !!o.preview)
}

function isAnswered(q: UserQuestion, selections: Record<string, string>, otherTexts: Record<string, string>): boolean {
  const key = questionKey(q)
  return !!(selections[key] || otherTexts[key]?.trim())
}

function buildAnswers(questions: UserQuestion[], selections: Record<string, string>, otherTexts: Record<string, string>): Record<string, string> {
  const answers: Record<string, string> = {}
  for (const q of questions) {
    const key = questionKey(q)
    answers[key] = otherTexts[key]?.trim() || selections[key] || ''
  }
  return answers
}

function buildAnnotations(questions: UserQuestion[], selections: Record<string, string>, notesTexts: Record<string, string>): QuestionAnnotations | undefined {
  const annotations: QuestionAnnotations = {}
  for (const q of questions) {
    const key = questionKey(q)
    const sel = selections[key]
    if (!sel) continue
    const notes = notesTexts[notesKey(q, sel)]?.trim()
    if (notes) annotations[key] = { notes }
  }
  return Object.keys(annotations).length > 0 ? annotations : undefined
}

function defaultSelections(questions: UserQuestion[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (const q of questions) {
    if (hasPreviewOptions(q) && q.options.length > 0) result[questionKey(q)] = q.options[0].label
  }
  return result
}

function isSelected(q: UserQuestion, selections: Record<string, string>, label: string): boolean {
  const sel = selections[questionKey(q)] ?? ''
  return q.multiSelect ? sel.split(', ').includes(label) : sel === label
}

const OPTION = 'cursor-pointer rounded text-left whitespace-normal transition'
/** Option-sized controls: compact beside their shortcuts, a finger's width on touch. */
const optionSize = (keys: boolean) => (keys ? 'px-2 py-1 text-xs' : 'px-3 py-2 text-sm')
const INPUT = 'w-full rounded border-0 bg-muted pr-2 text-foreground shadow-none placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring'

function OptionButtons({ q, selections, onSelect, keys, className }: {
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
          className={cn(OPTION, optionSize(keys), isSelected(q, selections, opt.label) ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground hover:bg-accent')}
        >
          {keys && <Kbd variant="square" className="mr-1.5">{i + 1}</Kbd>}
          {opt.label}
        </button>
      ))}
    </div>
  )
}

function OptionDescription({ q, selections }: { q: UserQuestion; selections: Record<string, string> }) {
  const sel = selections[questionKey(q)]
  if (!sel) return null
  const label = q.multiSelect ? sel.split(', ').pop() : sel
  const desc = q.options.find((o) => o.label === label)?.description
  if (!desc) return null
  return (
    <div className="mt-2 border-l-2 border-primary bg-primary/10 px-2.5 py-1.5 text-xs leading-snug text-primary">
      {desc}
    </div>
  )
}

/** A text field with the shortcut that reaches it drawn inside, when there is one. */
function KeyedInput({ keys, shortcut, inputRef, ...props }: {
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
        className={cn(INPUT, keys ? 'min-h-7 py-1.5 text-xs leading-4' : 'py-2 text-sm', shortcut != null ? 'pl-[30px]' : keys ? 'pl-2' : 'pl-3')}
      />
    </div>
  )
}

/** The preview of the option the person picked last, if it has one. */
function selectedPreview(q: UserQuestion, selections: Record<string, string>): string | null {
  const sel = selections[questionKey(q)]
  if (!sel) return null
  const label = q.multiSelect ? sel.split(', ').at(-1) : sel
  return q.options.find((o) => o.label === label)?.preview ?? null
}

function PreviewBox({ content, format, renderPreview }: { content: string; format: QuestionPreviewFormat; renderPreview: RenderPreview }) {
  return (
    <div className={cn('overflow-y-auto rounded-md border border-border/50 text-xs', format === 'html' ? 'max-h-[28rem] bg-transparent p-0' : 'max-h-64 bg-muted/30 p-3')}>
      {renderPreview({ content, format })}
    </div>
  )
}

/** Desktop: options beside (or above, for HTML) the preview; Other is a shortcut that swaps in a text field. */
function PreviewQuestionPanel({ q, previewFormat, selections, notesTexts, onSelect, onNotes, onOtherFocus, onNoteFocus, onNoteBlur, notesInputRef, renderPreview, onSubmit }: {
  q: UserQuestion
  previewFormat: QuestionPreviewFormat
  selections: Record<string, string>
  notesTexts: Record<string, string>
  onSelect: (q: UserQuestion, label: string) => void
  onNotes: (q: UserQuestion, text: string) => void
  onOtherFocus: () => void
  onNoteFocus: () => void
  onNoteBlur: () => void
  notesInputRef: RefObject<HTMLTextAreaElement | null>
  renderPreview: RenderPreview
  onSubmit: () => void
}) {
  const { t } = useTranslation()
  const key = questionKey(q)
  const previewContent = useMemo(() => selectedPreview(q, selections), [q, selections])
  const isHtml = previewFormat === 'html'

  return (
    <div>
      <p className="mb-2 text-xs font-medium text-foreground">{q.question}</p>
      <div className={cn('flex flex-col gap-3', !isHtml && '@[420px]:flex-row')}>
        <div className={cn('shrink-0', !isHtml && '@[420px]:max-w-[40%]')}>
          <OptionButtons q={q} selections={selections} onSelect={onSelect} keys
            className={isHtml ? 'flex flex-wrap gap-1.5' : 'flex flex-wrap gap-1.5 @[420px]:flex-col'} />
          <button
            type="button"
            onClick={onOtherFocus}
            className={cn('mt-1.5 cursor-pointer rounded bg-muted px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition', isHtml ? 'inline-block' : 'w-full')}
          >
            <Kbd variant="square" className="mr-1.5">{q.options.length + 1}</Kbd>
            {t('chat.askUser.otherOption')}
          </button>
        </div>
        <div className="min-w-0 flex-1">
          {previewContent ? (
            <PreviewBox content={previewContent} format={previewFormat} renderPreview={renderPreview} />
          ) : (
            <div className="flex h-full items-center justify-center rounded-md border border-dashed border-border/30 p-3 text-xs text-muted-foreground">
              {t('chat.askUser.selectOptionPreview')}
            </div>
          )}
          {previewContent && selections[key] && (
            <KeyedInput
              keys
              onSubmit={onSubmit}
              shortcut="n"
              inputRef={notesInputRef}
              placeholder={t('chat.askUser.noteOptionalPlaceholder')}
              value={notesTexts[notesKey(q, selections[key])] ?? ''}
              onChange={(text) => onNotes(q, text)}
              onFocus={onNoteFocus}
              onBlur={onNoteBlur}
            />
          )}
        </div>
      </div>
    </div>
  )
}

/** Desktop: options and an Other field, each with its digit. */
function SimpleQuestionPanel({ q, selections, otherTexts, onSelect, onOther, otherInputRef, onSubmit }: {
  q: UserQuestion
  selections: Record<string, string>
  otherTexts: Record<string, string>
  onSelect: (q: UserQuestion, label: string) => void
  onOther: (q: UserQuestion, text: string) => void
  otherInputRef: RefObject<HTMLTextAreaElement | null>
  onSubmit: () => void
}) {
  const { t } = useTranslation()
  return (
    <div>
      <p className="mb-2 text-xs font-medium text-foreground">{q.question}</p>
      <OptionButtons q={q} selections={selections} onSelect={onSelect} keys className="flex flex-wrap gap-1.5" />
      <KeyedInput
        keys
        onSubmit={onSubmit}
        shortcut={q.options.length + 1}
        inputRef={otherInputRef}
        placeholder={t('chat.askUser.otherOption')}
        value={otherTexts[questionKey(q)] ?? ''}
        onChange={(text) => onOther(q, text)}
      />
      <OptionDescription q={q} selections={selections} />
    </div>
  )
}

/**
 * Touch: one column, the Other field always last, just above the actions.
 * The pick's description, preview and note come between the options and it;
 * typing an Other answer clears the pick, and they go with it.
 */
function TouchQuestionPanel({ q, previewFormat, selections, otherTexts, notesTexts, onSelect, onOther, onNotes, otherInputRef, notesInputRef, renderPreview }: {
  q: UserQuestion
  previewFormat: QuestionPreviewFormat
  selections: Record<string, string>
  otherTexts: Record<string, string>
  notesTexts: Record<string, string>
  onSelect: (q: UserQuestion, label: string) => void
  onOther: (q: UserQuestion, text: string) => void
  onNotes: (q: UserQuestion, text: string) => void
  otherInputRef: RefObject<HTMLTextAreaElement | null>
  notesInputRef: RefObject<HTMLTextAreaElement | null>
  renderPreview: RenderPreview
}) {
  const { t } = useTranslation()
  const key = questionKey(q)
  const previewContent = selectedPreview(q, selections)
  return (
    <div>
      <p className="mb-2 text-xs font-medium text-foreground">{q.question}</p>
      <OptionButtons q={q} selections={selections} onSelect={onSelect} keys={false} className="flex flex-wrap gap-1.5" />
      <OptionDescription q={q} selections={selections} />
      {previewContent && (
        <div className="mt-2">
          <PreviewBox content={previewContent} format={previewFormat} renderPreview={renderPreview} />
          <KeyedInput
            keys={false}
            inputRef={notesInputRef}
            placeholder={t('chat.askUser.noteOptionalPlaceholder')}
            value={notesTexts[notesKey(q, selections[key])] ?? ''}
            onChange={(text) => onNotes(q, text)}
          />
        </div>
      )}
      <KeyedInput
        keys={false}
        inputRef={otherInputRef}
        placeholder={t('chat.askUser.otherOption')}
        value={otherTexts[key] ?? ''}
        onChange={(text) => onOther(q, text)}
      />
    </div>
  )
}

/**
 * The pending AskUserQuestion prompt, shared by the desktop composer and the
 * phone's chat document. Mount one per request (`key={requestId}`).
 */
export function AskUserQuestionForm({ request, onSubmit, onDismiss, renderPreview, keyboard }: AskUserQuestionFormProps) {
  const { t } = useTranslation()
  const { questions } = request
  const keys = !!keyboard
  const [selections, setSelections] = useState<Record<string, string>>(() => defaultSelections(questions))
  const [otherTexts, setOtherTexts] = useState<Record<string, string>>({})
  const [notesTexts, setNotesTexts] = useState<Record<string, string>>({})
  const [activeTab, setActiveTab] = useState(0)
  const [otherFocused, setOtherFocused] = useState(false)
  const [noteFocused, setNoteFocused] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const otherInputRef = useRef<HTMLTextAreaElement>(null)
  const notesInputRef = useRef<HTMLTextAreaElement>(null)

  const selectOption = useCallback((q: UserQuestion, label: string) => {
    const key = questionKey(q)
    if (q.multiSelect) {
      setSelections((s) => {
        const current = s[key] ?? ''
        const labels = current ? current.split(', ') : []
        const idx = labels.indexOf(label)
        if (idx !== -1) labels.splice(idx, 1)
        else labels.push(label)
        return { ...s, [key]: labels.join(', ') }
      })
    } else {
      setSelections((s) => ({ ...s, [key]: label }))
      setOtherTexts((s) => ({ ...s, [key]: '' }))
      setOtherFocused(false)
    }
  }, [])

  const allAnswered = questions.every((q) => isAnswered(q, selections, otherTexts))
  // The card outlives its answer until the host's resolution arrives: one response per request.
  const [settled, setSettled] = useState(false)
  const settledRef = useRef(false)
  const settle = useCallback((respond: () => void) => {
    if (settledRef.current) return
    settledRef.current = true
    setSettled(true)
    respond()
  }, [])
  const submit = useCallback(() => {
    settle(() => onSubmit(buildAnswers(questions, selections, otherTexts), buildAnnotations(questions, selections, notesTexts)))
  }, [settle, onSubmit, questions, selections, otherTexts, notesTexts])
  const dismiss = useCallback(() => settle(onDismiss), [settle, onDismiss])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // A key something else already took (a mod's hotkey band) is not ours.
    if (e.defaultPrevented || !keyboard?.inScope(e)) return
    const typing = document.activeElement === otherInputRef.current || document.activeElement === notesInputRef.current

    if (e.key === 'Escape') {
      e.preventDefault()
      if (typing) rootRef.current?.focus()
      else dismiss()
      return
    }

    if (e.key === 'Tab' && questions.length > 1) {
      e.preventDefault()
      if (typing) rootRef.current?.focus()
      setActiveTab((tab) => (e.shiftKey ? (tab > 0 ? tab - 1 : questions.length - 1) : (tab < questions.length - 1 ? tab + 1 : 0)))
      return
    }

    if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.isComposing) {
      if (allAnswered) {
        e.preventDefault()
        submit()
      }
      return
    }

    const q = questions[activeTab] ?? questions[0]
    const num = parseInt(e.key)
    if (typing && e.ctrlKey) {
      if (num >= 1 && num <= q.options.length) {
        e.preventDefault()
        rootRef.current?.focus()
        selectOption(q, q.options[num - 1].label)
        setOtherFocused(false)
      }
      return
    }
    if (typing) return

    const qKey = questionKey(q)
    if (e.key === 'n' && hasPreviewOptions(q) && !otherFocused && !otherTexts[qKey] && selections[qKey]) {
      e.preventDefault()
      notesInputRef.current?.focus()
      return
    }
    if (num >= 1 && num <= q.options.length) {
      e.preventDefault()
      selectOption(q, q.options[num - 1].label)
      return
    }
    if (num === q.options.length + 1) {
      e.preventDefault()
      setSelections((s) => ({ ...s, [qKey]: '' }))
      setOtherFocused(true)
    }
  }, [keyboard, questions, activeTab, selections, otherTexts, otherFocused, allAnswered, submit, dismiss, selectOption])

  useEffect(() => {
    if (!keyboard) return
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [keyboard, handleKeyDown])

  useEffect(() => {
    if (otherFocused) requestAnimationFrame(() => otherInputRef.current?.focus())
  }, [otherFocused])

  function setOther(q: UserQuestion, text: string) {
    const key = questionKey(q)
    setOtherTexts((s) => ({ ...s, [key]: text }))
    setSelections((s) => ({ ...s, [key]: '' }))
  }

  function setNotes(q: UserQuestion, text: string) {
    const sel = selections[questionKey(q)]
    if (!sel) return
    setNotesTexts((s) => ({ ...s, [notesKey(q, sel)]: text }))
  }

  const singleQuestion = questions.length === 1
  const activeQuestion = singleQuestion ? questions[0] : questions[activeTab]
  if (!activeQuestion) return null
  const isPreview = hasPreviewOptions(activeQuestion) && !otherFocused && !otherTexts[questionKey(activeQuestion)]
  const separator = <span className="mx-1 opacity-40">·</span>

  return (
    // Focusable with a keyboard: leaving a text field (Escape, Tab, ctrl+digit) lands here
    // instead of on <body>, where the host's `inScope` would stop taking the form's keys.
    <div ref={rootRef} tabIndex={keys ? -1 : undefined} className="@container rounded-lg border border-primary/40 bg-card p-3 outline-none" data-ask-user-question={request.requestId}>
      {!singleQuestion && (
        <div className="mb-3 flex gap-1 overflow-x-auto border-b border-border/50 pb-2">
          {questions.map((q, i) => (
            <button
              key={questionKey(q)}
              type="button"
              onClick={() => setActiveTab(i)}
              className={cn('relative shrink-0 cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium transition', activeTab === i ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground')}
            >
              {q.header}
              {isAnswered(q, selections, otherTexts) && <span className="ml-1 text-xs text-green-500">&#10003;</span>}
            </button>
          ))}
        </div>
      )}
      {!keys ? (
        <TouchQuestionPanel
          q={activeQuestion}
          previewFormat={request.previewFormat ?? 'markdown'}
          selections={selections}
          otherTexts={otherTexts}
          notesTexts={notesTexts}
          onSelect={selectOption}
          onOther={setOther}
          onNotes={setNotes}
          otherInputRef={otherInputRef}
          notesInputRef={notesInputRef}
          renderPreview={renderPreview}
        />
      ) : isPreview ? (
        <PreviewQuestionPanel
          q={activeQuestion}
          previewFormat={request.previewFormat ?? 'markdown'}
          selections={selections}
          notesTexts={notesTexts}
          onSelect={selectOption}
          onNotes={setNotes}
          onOtherFocus={() => {
            setSelections((s) => ({ ...s, [questionKey(activeQuestion)]: '' }))
            setOtherFocused(true)
          }}
          onNoteFocus={() => setNoteFocused(true)}
          onNoteBlur={() => setNoteFocused(false)}
          onSubmit={() => { if (allAnswered && keyboard?.inScope()) submit() }}
          notesInputRef={notesInputRef}
          renderPreview={renderPreview}
        />
      ) : (
        <SimpleQuestionPanel
          q={activeQuestion}
          selections={selections}
          otherTexts={otherTexts}
          onSelect={selectOption}
          onOther={setOther}
          otherInputRef={otherInputRef}
          onSubmit={() => { if (allAnswered && keyboard?.inScope()) submit() }}
        />
      )}
      {/* Touch: the two actions share the row, as the phone's prompt sheets drew them. */}
      <div className={cn('mt-3 flex items-center', keys ? 'gap-3' : 'gap-2')}>
        <Button
          size="sm"
          disabled={!allAnswered || settled}
          className={cn('cursor-pointer bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50', keys ? 'h-7 px-4 text-xs' : 'h-10 flex-1 text-sm')}
          onClick={submit}
        >
          {t('chat.askUser.submit')}
          {keys && <Kbd variant="inline" className="ml-1 text-primary-foreground/70 dark:text-white/70">↵</Kbd>}
        </Button>
        {keys ? (
          <span className="text-xs text-muted-foreground">
            {!singleQuestion && <><Kbd>⇥</Kbd><span className="ml-0.5">{t('chat.askUser.hintSwitch')}</span>{separator}</>}
            {isPreview && selections[questionKey(activeQuestion)] && <><Kbd>n</Kbd><span className="ml-0.5">{t('chat.askUser.hintNote')}</span>{separator}</>}
            {otherFocused || noteFocused
              ? <><Kbd>ctrl</Kbd>+<Kbd>num</Kbd><span className="ml-0.5">{t('chat.askUser.hintSelect')}</span>{separator}</>
              : <><Kbd>num</Kbd><span className="ml-0.5">{t('chat.askUser.hintSelect')}</span>{separator}</>}
            <Kbd>esc</Kbd><span className="ml-0.5">{t('chat.askUser.hintDismiss')}</span>
          </span>
        ) : (
          <Button size="sm" variant="outline" disabled={settled} className="h-10 flex-1 text-sm" onClick={dismiss}>
            {t('chat.askUser.dismiss')}
          </Button>
        )}
      </div>
    </div>
  )
}
