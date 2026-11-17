import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@superone/ui/components/ui/button'
import { Kbd, NewlineKeys } from '@superone/ui/components/ui/kbd'
import { cn } from '@superone/ui/lib/utils'
import type { AskUserQuestionRequest, QuestionAnnotations, QuestionPreviewFormat, UserQuestion } from '@superone/shared/agent-types'
import {
  hasPreviewOptions,
  KeyedInput,
  OptionButtons,
  OptionDescriptionCallout,
  QuestionPreviewBox,
  questionKey,
  QuestionTabs,
  selectedOptionLabels,
  selectedOptionPreview,
  type RenderQuestionPreview,
} from './AskUserQuestionShared'

type RenderPreview = RenderQuestionPreview

export interface AskUserQuestionFormProps {
  request: AskUserQuestionRequest
  onSubmit: (answers: Record<string, string>, annotations?: QuestionAnnotations) => void | Promise<void>
  onDismiss: () => void | Promise<void>
  /** Host-provided preview body: sanitized HTML on the desktop, a sandboxed frame in the WebView. */
  renderPreview: RenderPreview
  /**
   * Digit, Tab, Enter and Escape shortcuts with their hints, for hosts with a
   * keyboard. `inScope` says whether a key belongs to this form; `mac` picks the
   * key glyphs. A touch host omits it and gets a Dismiss button instead.
   */
  keyboard?: { inScope: (event?: KeyboardEvent) => boolean; mac: boolean }
}

function notesKey(q: UserQuestion, optionLabel: string): string {
  return `${questionKey(q)}\0${optionLabel}`
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

function OptionDescription({ q, selections }: { q: UserQuestion; selections: Record<string, string> }) {
  const labels = selectedOptionLabels(selections[questionKey(q)], q.multiSelect)
  return <OptionDescriptionCallout options={q.options} labels={labels} multiSelect={q.multiSelect} />
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
  const previewContent = useMemo(() => selectedOptionPreview(q, selections), [q, selections])
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
            <QuestionPreviewBox content={previewContent} format={previewFormat} renderPreview={renderPreview} />
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
function SimpleQuestionPanel({ q, selections, otherTexts, onSelect, onOther, onOtherFocus, onOtherBlur, otherInputRef, onSubmit }: {
  q: UserQuestion
  selections: Record<string, string>
  otherTexts: Record<string, string>
  onSelect: (q: UserQuestion, label: string) => void
  onOther: (q: UserQuestion, text: string) => void
  onOtherFocus: () => void
  onOtherBlur: () => void
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
        onFocus={onOtherFocus}
        onBlur={onOtherBlur}
      />
      <OptionDescription q={q} selections={selections} />
    </div>
  )
}

/** Touch: the question sits outside the scrolling options, so a short slot never cuts it. */
function TouchQuestionText({ q }: { q: UserQuestion }) {
  return (
    <div className="mb-2 shrink-0">
      {q.header && <p className="text-xs text-muted-foreground">{q.header}</p>}
      <p className="text-sm font-medium leading-snug text-foreground">{q.question}</p>
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
  const previewContent = selectedOptionPreview(q, selections)
  return (
    <div>
      <OptionButtons q={q} selections={selections} onSelect={onSelect} keys={false} className="flex flex-wrap gap-1.5" />
      <OptionDescription q={q} selections={selections} />
      {previewContent && (
        <div className="mt-2">
          <QuestionPreviewBox content={previewContent} format={previewFormat} renderPreview={renderPreview} />
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
  // Either text field: digits type there, so the hints switch to ctrl+digit and newline keys.
  const [textFocused, setTextFocused] = useState(false)
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
  const [error, setError] = useState<string | null>(null)
  const settledRef = useRef(false)
  const settle = useCallback((respond: () => void | Promise<void>) => {
    if (settledRef.current) return
    settledRef.current = true
    setSettled(true)
    setError(null)
    const failed = (cause: unknown) => {
      settledRef.current = false
      setSettled(false)
      setError(cause instanceof Error ? cause.message : String(cause))
    }
    try {
      const result = respond()
      if (result) void result.catch(failed)
    } catch (cause) { failed(cause) }
  }, [])
  const submit = useCallback(() => {
    settle(() => onSubmit(buildAnswers(questions, selections, otherTexts), buildAnnotations(questions, selections, notesTexts)))
  }, [settle, onSubmit, questions, selections, otherTexts, notesTexts])
  const dismiss = useCallback(() => settle(onDismiss), [settle, onDismiss])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // A key something else already took (a mod's hotkey band) is not ours.
    if (e.defaultPrevented || settledRef.current || !keyboard?.inScope(e)) return
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
    <div ref={rootRef} tabIndex={keys ? -1 : undefined} className="@container flex min-h-0 flex-col rounded-lg border border-primary/40 bg-card p-3 outline-none" data-ask-user-question={request.requestId}>
      {/* A height-capped slot scrolls only the question; the tabs and actions stay in view.
          A fieldset can't pass that height to its rows, so it only disables them. */}
      <fieldset disabled={settled} className="contents">
      {!singleQuestion && (
        <QuestionTabs
          questions={questions}
          activeTab={activeTab}
          onSelectTab={setActiveTab}
          isTabAnswered={(q) => isAnswered(q, selections, otherTexts)}
        />
      )}
      {!keys && <TouchQuestionText q={activeQuestion} />}
      {/* Padded past every edge so a focused field's ring is not clipped by the scroller. */}
      <div className="-mx-3 -my-1 min-h-0 overflow-y-auto px-3 py-1">
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
          onNoteFocus={() => setTextFocused(true)}
          onNoteBlur={() => setTextFocused(false)}
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
          onOtherFocus={() => setTextFocused(true)}
          onOtherBlur={() => setTextFocused(false)}
          otherInputRef={otherInputRef}
          onSubmit={() => { if (allAnswered && keyboard?.inScope()) submit() }}
        />
      )}
      </div>
      {/* Touch: the two actions share the row, as the phone's prompt sheets drew them. */}
      <div className={cn('mt-3 flex shrink-0 items-center', keys ? 'gap-3' : 'gap-2')}>
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
            {textFocused && <><span className="inline-flex items-center gap-0.5"><NewlineKeys label={t('chat.askUser.hintNewline')} mac={keyboard.mac} /></span>{separator}</>}
            {textFocused
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
      </fieldset>
      {error && <p role="alert" className="mt-2 shrink-0 text-xs text-destructive">{error}</p>}
    </div>
  )
}
