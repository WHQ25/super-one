import { useState, useEffect, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { useChatStore, useActiveSession } from '@/stores/chat'
import { Kbd } from '@/components/ui/kbd'
import type { UserQuestion } from '../../../../shared/agent-types'

function questionKey(q: UserQuestion): string {
  return q.id ?? q.question
}

function showOtherInput(q: UserQuestion): boolean {
  return q.allowOther !== false
}

function isAnswered(
  q: UserQuestion,
  selections: Record<string, string>,
  otherTexts: Record<string, string>,
): boolean {
  const key = questionKey(q)
  return !!(selections[key] || (showOtherInput(q) && otherTexts[key]))
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

function QuestionPanel({
  q,
  selections,
  otherTexts,
  onSelect,
  onOther,
  inputRef
}: {
  q: UserQuestion
  selections: Record<string, string>
  otherTexts: Record<string, string>
  onSelect: (q: UserQuestion, label: string) => void
  onOther: (q: UserQuestion, text: string) => void
  inputRef: React.RefObject<HTMLInputElement | null>
}) {
  const key = questionKey(q)
  const allowOther = showOtherInput(q)

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
              className={`cursor-pointer rounded px-2 py-1 text-xs transition ${
                selected
                  ? 'bg-blue-600 text-white'
                  : 'bg-muted text-foreground hover:bg-accent'
              }`}
              title={opt.description}
            >
              <Kbd variant="square" className="mr-1.5">{i + 1}</Kbd>
              {opt.label}
            </button>
          )
        })}
      </div>
      {allowOther && (
        <div className="relative mt-2">
          <Kbd variant="square" className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2">
            {q.options.length + 1}
          </Kbd>
          <input
            ref={inputRef}
            type="text"
            placeholder="Other..."
            value={otherTexts[key] ?? ''}
            onChange={(e) => onOther(q, e.target.value)}
            className="w-full rounded bg-muted py-1 pl-[30px] pr-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      )}
    </div>
  )
}

export function AskUserQuestionPrompt() {
  const pendingQuestion = useActiveSession((s) => s.pendingQuestion)
  const answerQuestion = useChatStore((s) => s.answerQuestion)
  const dismissQuestion = useChatStore((s) => s.dismissQuestion)

  const [selections, setSelections] = useState<Record<string, string>>({})
  const [otherTexts, setOtherTexts] = useState<Record<string, string>>({})
  const [activeTab, setActiveTab] = useState(0)
  const otherInputRef = useRef<HTMLInputElement>(null)

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
    }
  }, [])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!pendingQuestion) return
    const { questions } = pendingQuestion
    const isTyping = document.activeElement === otherInputRef.current

    if (e.key === 'Escape') {
      e.preventDefault()
      if (isTyping) {
        otherInputRef.current?.blur()
      } else {
        dismissQuestion(pendingQuestion.requestId)
        setSelections({})
        setOtherTexts({})
        setActiveTab(0)
      }
      return
    }

    if (e.key === 'Tab' && questions.length > 1) {
      e.preventDefault()
      otherInputRef.current?.blur()
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
        answerQuestion(pendingQuestion.requestId, buildAnswers(questions, selections, otherTexts))
        setSelections({})
        setOtherTexts({})
        setActiveTab(0)
      }
      return
    }

    if (isTyping) return

    const q = questions[activeTab] ?? questions[0]
    const num = parseInt(e.key)
    if (num >= 1 && num <= q.options.length) {
      e.preventDefault()
      selectOption(q, q.options[num - 1].label)
      return
    }
    if (showOtherInput(q) && num === q.options.length + 1) {
      e.preventDefault()
      otherInputRef.current?.focus()
      return
    }
  }, [pendingQuestion, activeTab, selections, otherTexts, dismissQuestion, answerQuestion, selectOption])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  useEffect(() => {
    setActiveTab(0)
  }, [pendingQuestion?.requestId])

  if (!pendingQuestion) return null

  const { requestId, questions } = pendingQuestion

  function setOther(q: UserQuestion, text: string) {
    const key = questionKey(q)
    setOtherTexts((s) => ({ ...s, [key]: text }))
    setSelections((s) => ({ ...s, [key]: '' }))
  }

  function handleSubmit() {
    answerQuestion(requestId, buildAnswers(questions, selections, otherTexts))
    setSelections({})
    setOtherTexts({})
    setActiveTab(0)
  }

  const allAnswered = questions.every((q) => isAnswered(q, selections, otherTexts))

  const singleQuestion = questions.length === 1

  return (
    <div className="mx-3 mb-2 rounded-lg border border-blue-600/40 bg-muted/60 p-3">
      {singleQuestion ? (
        <QuestionPanel
          q={questions[0]}
          selections={selections}
          otherTexts={otherTexts}
          onSelect={selectOption}
          onOther={setOther}
          inputRef={otherInputRef}
        />
      ) : (
        <>
          <div className="mb-3 flex gap-1 border-b border-border/50 pb-2">
            {questions.map((q, i) => (
              <button
                key={questionKey(q)}
                onClick={() => setActiveTab(i)}
                className={`relative cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium transition ${
                  activeTab === i
                    ? 'bg-blue-600/15 text-blue-500'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {q.header}
                {isAnswered(q, selections, otherTexts) && (
                  <span className="ml-1 text-[10px] text-green-500">&#10003;</span>
                )}
              </button>
            ))}
          </div>
          <QuestionPanel
            q={questions[activeTab]}
            selections={selections}
            otherTexts={otherTexts}
            onSelect={selectOption}
            onOther={setOther}
            inputRef={otherInputRef}
          />
        </>
      )}
      <div className="mt-3 flex items-center gap-3">
        <Button
          size="sm"
          disabled={!allAnswered}
          className="h-7 cursor-pointer bg-blue-600 px-4 text-xs text-white hover:bg-blue-500 disabled:opacity-50"
          onClick={handleSubmit}
        >
          Submit
          <Kbd variant="inline" className="ml-1 text-white/70">↵</Kbd>
        </Button>
        <span className="text-[10px] text-muted-foreground">
          {!singleQuestion && <><Kbd>⇥</Kbd><span className="ml-0.5">switch</span><span className="mx-1 opacity-40">·</span></>}
          <Kbd>esc</Kbd><span className="ml-0.5">dismiss</span>
        </span>
      </div>
    </div>
  )
}
