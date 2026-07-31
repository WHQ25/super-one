import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@superone/ui/components/ui/button'
import { useChatStore, useActiveSession } from '@/stores/chat'
import { Kbd } from '@superone/ui/components/ui/kbd'
import { QuestionPreviewContent as PreviewContent } from './tool-result-views'
import { useRestoreChatInputFocus } from '@/hooks/useRestoreChatInputFocus'
import { isFocusInChat } from './is-focus-in-chat'
import type { UserQuestion, QuestionAnnotations, QuestionPreviewFormat } from '@superone/shared/agent-types'

function questionKey(q: UserQuestion): string {
  return q.question
}

function notesKey(q: UserQuestion, optionLabel: string): string {
  return `${q.question}\0${optionLabel}`
}

function hasPreviewOptions(q: UserQuestion): boolean {
  return q.options.some((o) => !!o.preview)
}

function isAnswered(
  q: UserQuestion,
  selections: Record<string, string>,
  otherTexts: Record<string, string>,
): boolean {
  const key = questionKey(q)
  return !!(selections[key] || otherTexts[key])
}

function buildAnswers(
  questions: UserQuestion[],
  selections: Record<string, string>,
  otherTexts: Record<string, string>,
): Record<string, string> {
  const answers: Record<string, string> = {}
  for (const q of questions) {
    const key = questionKey(q)
    answers[key] = otherTexts[key] || selections[key] || ''
  }
  return answers
}

function buildAnnotations(
  questions: UserQuestion[],
  selections: Record<string, string>,
  notesTexts: Record<string, string>,
): QuestionAnnotations | undefined {
  const annotations: QuestionAnnotations = {}
  for (const q of questions) {
    const key = questionKey(q)
    const sel = selections[key]
    if (!sel) continue
    const notes = notesTexts[notesKey(q, sel)]?.trim()
    if (notes) {
      annotations[key] = { notes }
    }
  }
  return Object.keys(annotations).length > 0 ? annotations : undefined
}

function OptionButtons({
  q,
  selections,
  onSelect,
  horizontal = false,
}: {
  q: UserQuestion
  selections: Record<string, string>
  onSelect: (q: UserQuestion, label: string) => void
  horizontal?: boolean
}) {
  const key = questionKey(q)
  return (
    <div className={horizontal ? 'flex flex-wrap gap-1.5' : 'flex flex-wrap gap-1.5 @[420px]:flex-col'}>
      {q.options.map((opt, i) => {
        const selected = q.multiSelect
          ? (selections[key] ?? '').split(', ').includes(opt.label)
          : selections[key] === opt.label
        return (
          <button
            key={opt.label}
            onClick={() => onSelect(q, opt.label)}
            className={`cursor-pointer rounded px-2 py-1 text-xs text-left whitespace-normal transition @[420px]:py-1.5 ${
              selected
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-foreground hover:bg-accent'
            }`}
          >
            <Kbd variant="square" className="mr-1.5">{i + 1}</Kbd>
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

function OptionDescription({
  q,
  selections,
}: {
  q: UserQuestion
  selections: Record<string, string>
}) {
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

function PreviewQuestionPanel({
  q,
  previewFormat,
  selections,
  notesTexts,
  onSelect,
  onNotes,
  onOtherFocus,
  onNoteFocus,
  onNoteBlur,
  notesInputRef,
}: {
  q: UserQuestion
  previewFormat: QuestionPreviewFormat
  selections: Record<string, string>
  notesTexts: Record<string, string>
  onSelect: (q: UserQuestion, label: string) => void
  onNotes: (q: UserQuestion, text: string) => void
  onOtherFocus: () => void
  onNoteFocus: () => void
  onNoteBlur: () => void
  notesInputRef: React.RefObject<HTMLInputElement | null>
}) {
  const { t } = useTranslation()
  const key = questionKey(q)

  const previewContent = useMemo(() => {
    const sel = selections[key]
    if (!sel) return null
    if (q.multiSelect) {
      const labels = sel.split(', ')
      const last = labels[labels.length - 1]
      return q.options.find((o) => o.label === last)?.preview ?? null
    }
    return q.options.find((o) => o.label === sel)?.preview ?? null
  }, [q, selections, key])

  const isHtml = previewFormat === 'html'

  return (
    <div>
      <p className="mb-2 text-xs font-medium text-foreground">{q.question}</p>
      <div className={`flex flex-col gap-3 ${isHtml ? '' : '@[420px]:flex-row'}`}>
        <div className={`shrink-0 ${isHtml ? '' : '@[420px]:max-w-[40%]'}`}>
          <OptionButtons q={q} selections={selections} onSelect={onSelect} horizontal={isHtml} />
          <button
            onClick={onOtherFocus}
            className={`mt-1.5 cursor-pointer rounded bg-muted px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition ${isHtml ? 'inline-block' : 'w-full'}`}
          >
            <Kbd variant="square" className="mr-1.5">{q.options.length + 1}</Kbd>
            {t('chat.askUser.otherOption')}
          </button>
        </div>
        <div className="min-w-0 flex-1">
          {previewContent ? (
            <div className={`overflow-y-auto rounded-md border border-border/50 text-xs ${isHtml ? 'max-h-[28rem] bg-transparent p-0' : 'max-h-64 bg-muted/30 p-3'}`}>
              <PreviewContent content={previewContent} format={previewFormat} />
            </div>
          ) : (
            <div className="flex h-full items-center justify-center rounded-md border border-dashed border-border/30 p-3 text-xs text-muted-foreground">
              {t('chat.askUser.selectOptionPreview')}
            </div>
          )}
          {previewContent && selections[key] && (
            <div className="relative mt-2">
              <Kbd variant="square" className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2">n</Kbd>
              <input
                ref={notesInputRef}
                type="text"
                placeholder={t('chat.askUser.noteOptionalPlaceholder')}
                value={notesTexts[notesKey(q, selections[key])] ?? ''}
                onChange={(e) => onNotes(q, e.target.value)}
                onFocus={onNoteFocus}
                onBlur={onNoteBlur}
                className="w-full rounded bg-muted py-1 pl-[30px] pr-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function SimpleQuestionPanel({
  q,
  selections,
  otherTexts,
  onSelect,
  onOther,
  otherInputRef,
}: {
  q: UserQuestion
  selections: Record<string, string>
  otherTexts: Record<string, string>
  onSelect: (q: UserQuestion, label: string) => void
  onOther: (q: UserQuestion, text: string) => void
  otherInputRef: React.RefObject<HTMLInputElement | null>
}) {
  const { t } = useTranslation()
  const key = questionKey(q)

  return (
    <div>
      <p className="mb-2 text-xs font-medium text-foreground">{q.question}</p>
      <div className="flex flex-wrap gap-1.5">
        {q.options.map((opt, i) => {
          const selected = q.multiSelect
            ? (selections[key] ?? '').split(', ').includes(opt.label)
            : selections[key] === opt.label
          return (
            <button
              key={opt.label}
              onClick={() => onSelect(q, opt.label)}
              className={`cursor-pointer rounded px-2 py-1 text-xs text-left whitespace-normal transition ${
                selected
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-foreground hover:bg-accent'
              }`}
            >
              <Kbd variant="square" className="mr-1.5">{i + 1}</Kbd>
              {opt.label}
            </button>
          )
        })}
      </div>
      <div className="relative mt-2">
        <Kbd variant="square" className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2">
          {q.options.length + 1}
        </Kbd>
        <input
          ref={otherInputRef}
          type="text"
          placeholder={t('chat.askUser.otherOption')}
          value={otherTexts[key] ?? ''}
          onChange={(e) => onOther(q, e.target.value)}
          className="w-full rounded bg-muted py-1 pl-[30px] pr-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
      <OptionDescription q={q} selections={selections} />
    </div>
  )
}

function defaultSelections(questions: UserQuestion[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (const q of questions) {
    if (hasPreviewOptions(q) && q.options.length > 0) {
      result[questionKey(q)] = q.options[0].label
    }
  }
  return result
}

export function AskUserQuestionPrompt() {
  const { t } = useTranslation()
  const pendingQuestion = useActiveSession((s) => s.pendingQuestion)
  const answerQuestion = useChatStore((s) => s.answerQuestion)
  const dismissQuestion = useChatStore((s) => s.dismissQuestion)
  useRestoreChatInputFocus(!!pendingQuestion)

  const [selections, setSelections] = useState<Record<string, string>>({})
  const [otherTexts, setOtherTexts] = useState<Record<string, string>>({})
  const [notesTexts, setNotesTexts] = useState<Record<string, string>>({})
  const [activeTab, setActiveTab] = useState(0)
  const [otherFocused, setOtherFocused] = useState(false)
  const [noteFocused, setNoteFocused] = useState(false)
  const otherInputRef = useRef<HTMLInputElement>(null)
  const notesInputRef = useRef<HTMLInputElement>(null)

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

  const isTypingInInput = useCallback(() => {
    return document.activeElement === otherInputRef.current || document.activeElement === notesInputRef.current
  }, [])

  const resetState = useCallback(() => {
    setSelections({})
    setOtherTexts({})
    setNoteFocused(false)
    setNotesTexts({})
    setActiveTab(0)
    setOtherFocused(false)
  }, [])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!pendingQuestion) return
    // When the user is working in another panel (file editor, terminal, browser
    // chrome, etc.), digit keys must type there — not select options here.
    if (!isFocusInChat()) return
    const { questions } = pendingQuestion
    const typing = isTypingInInput()

    if (e.key === 'Escape') {
      e.preventDefault()
      if (typing) {
        (document.activeElement as HTMLElement)?.blur()
      } else {
        dismissQuestion(pendingQuestion.requestId)
        resetState()
      }
      return
    }

    if (e.key === 'Tab' && questions.length > 1) {
      e.preventDefault()
      if (typing) (document.activeElement as HTMLElement)?.blur()
      if (e.shiftKey) {
        setActiveTab((t) => (t > 0 ? t - 1 : questions.length - 1))
      } else {
        setActiveTab((t) => (t < questions.length - 1 ? t + 1 : 0))
      }
      return
    }

    if (e.key === 'Enter' && !e.isComposing) {
      if (questions.every((q) => isAnswered(q, selections, otherTexts))) {
        e.preventDefault()
        answerQuestion(
          pendingQuestion.requestId,
          buildAnswers(questions, selections, otherTexts),
          buildAnnotations(questions, selections, notesTexts),
        )
        resetState()
      }
      return
    }

    if (typing && e.ctrlKey) {
      const q = questions[activeTab] ?? questions[0]
      const num = parseInt(e.key)
      if (num >= 1 && num <= q.options.length) {
        e.preventDefault()
        ;(document.activeElement as HTMLElement)?.blur()
        selectOption(q, q.options[num - 1].label)
        setOtherFocused(false)
        return
      }
    }

    if (typing) return

    if (e.key === 'n') {
      const q = questions[activeTab] ?? questions[0]
      const qKey = questionKey(q)
      if (hasPreviewOptions(q) && !otherFocused && !otherTexts[qKey] && selections[qKey]) {
        e.preventDefault()
        notesInputRef.current?.focus()
        return
      }
    }

    const q = questions[activeTab] ?? questions[0]
    const num = parseInt(e.key)
    if (num >= 1 && num <= q.options.length) {
      e.preventDefault()
      selectOption(q, q.options[num - 1].label)
      return
    }
    if (num === q.options.length + 1) {
      e.preventDefault()
      setSelections((s) => ({ ...s, [questionKey(q)]: '' }))
      setOtherFocused(true)
      return
    }
  }, [pendingQuestion, activeTab, selections, otherTexts, otherFocused, notesTexts, dismissQuestion, answerQuestion, selectOption, isTypingInInput, resetState])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  useEffect(() => {
    if (!pendingQuestion) return
    setSelections(defaultSelections(pendingQuestion.questions))
    setOtherTexts({})
    setNotesTexts({})
    setActiveTab(0)
    setOtherFocused(false)
  }, [pendingQuestion?.requestId])

  useEffect(() => {
    if (otherFocused) {
      requestAnimationFrame(() => otherInputRef.current?.focus())
    }
  }, [otherFocused])

  if (!pendingQuestion) return null

  const { requestId, questions } = pendingQuestion

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

  function handleSubmit() {
    answerQuestion(
      requestId,
      buildAnswers(questions, selections, otherTexts),
      buildAnnotations(questions, selections, notesTexts),
    )
    resetState()
  }

  const allAnswered = questions.every((q) => isAnswered(q, selections, otherTexts))
  const singleQuestion = questions.length === 1
  const activeQuestion = singleQuestion ? questions[0] : questions[activeTab]
  const isPreview = hasPreviewOptions(activeQuestion) && !otherFocused && !otherTexts[questionKey(activeQuestion)]

  const panelContent = isPreview ? (
    <PreviewQuestionPanel
      q={activeQuestion}
      previewFormat={pendingQuestion.previewFormat ?? 'markdown'}
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
      notesInputRef={notesInputRef}
    />
  ) : (
    <SimpleQuestionPanel
      q={activeQuestion}
      selections={selections}
      otherTexts={otherTexts}
      onSelect={selectOption}
      onOther={setOther}
      otherInputRef={otherInputRef}
    />
  )

  return (
    <div className="@container mx-3 mb-2 rounded-lg border border-primary/40 bg-card p-3">
      {!singleQuestion && (
        <div className="mb-3 flex gap-1 border-b border-border/50 pb-2">
          {questions.map((q, i) => (
            <button
              key={questionKey(q)}
              onClick={() => setActiveTab(i)}
              className={`relative cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium transition ${
                activeTab === i
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {q.header}
              {isAnswered(q, selections, otherTexts) && (
                <span className="ml-1 text-xs text-green-500">&#10003;</span>
              )}
            </button>
          ))}
        </div>
      )}
      {panelContent}
      <div className="mt-3 flex items-center gap-3">
        <Button
          size="sm"
          disabled={!allAnswered}
          className="h-7 cursor-pointer bg-primary px-4 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          onClick={handleSubmit}
        >
          {t('chat.askUser.submit')}
          <Kbd variant="inline" className="ml-1 text-primary-foreground/70 dark:text-white/70">↵</Kbd>
        </Button>
        <span className="text-xs text-muted-foreground">
          {!singleQuestion && <><Kbd>⇥</Kbd><span className="ml-0.5">{t('chat.askUser.hintSwitch')}</span><span className="mx-1 opacity-40">·</span></>}
          {isPreview && selections[questionKey(activeQuestion)] && <><Kbd>n</Kbd><span className="ml-0.5">{t('chat.askUser.hintNote')}</span><span className="mx-1 opacity-40">·</span></>}
          {otherFocused || noteFocused
            ? <><Kbd>ctrl</Kbd>+<Kbd>num</Kbd><span className="ml-0.5">{t('chat.askUser.hintSelect')}</span><span className="mx-1 opacity-40">·</span></>
            : <><Kbd>num</Kbd><span className="ml-0.5">{t('chat.askUser.hintSelect')}</span><span className="mx-1 opacity-40">·</span></>}
          <Kbd>esc</Kbd><span className="ml-0.5">{t('chat.askUser.hintDismiss')}</span>
        </span>
      </div>
    </div>
  )
}
