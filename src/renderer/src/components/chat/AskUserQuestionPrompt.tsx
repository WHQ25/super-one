import { useState, useEffect, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { useChatStore, useActiveSession } from '@/stores/chat'
import { CommandShortcut } from '@/components/ui/command'
import type { UserQuestion } from '../../../../shared/agent-types'

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
  return (
    <div>
      <p className="mb-2 text-xs font-medium text-foreground">{q.question}</p>
      <div className="flex flex-wrap gap-1.5">
        {q.options.map((opt, i) => {
          const selected = q.multiSelect
            ? (selections[q.question] ?? '').split(', ').includes(opt.label)
            : selections[q.question] === opt.label
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
              <CommandShortcut className="mr-1 font-mono text-[10px] opacity-50">{i + 1}</CommandShortcut>
              {opt.label}
            </button>
          )
        })}
      </div>
      <div className="relative mt-2">
        <CommandShortcut className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 font-mono text-[10px] text-muted-foreground/50">
          {q.options.length + 1}
        </CommandShortcut>
        <input
          ref={inputRef}
          type="text"
          placeholder="Other..."
          value={otherTexts[q.question] ?? ''}
          onChange={(e) => onOther(q, e.target.value)}
          className="w-full rounded bg-muted py-1 pl-6 pr-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>
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
    if (q.multiSelect) {
      setSelections((s) => {
        const current = s[q.question] ?? ''
        const labels = current ? current.split(', ') : []
        const idx = labels.indexOf(label)
        if (idx !== -1) labels.splice(idx, 1)
        else labels.push(label)
        return { ...s, [q.question]: labels.join(', ') }
      })
    } else {
      setSelections((s) => ({ ...s, [q.question]: label }))
      setOtherTexts((s) => ({ ...s, [q.question]: '' }))
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

    // Tab / Shift+Tab to switch tabs (works even when typing)
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

    // Don't intercept keys when typing in the Other input
    if (isTyping) return

    const q = questions[activeTab] ?? questions[0]

    // Number keys: 1-N select options, N+1 focuses Other input
    const num = parseInt(e.key)
    if (num >= 1 && num <= q.options.length) {
      e.preventDefault()
      selectOption(q, q.options[num - 1].label)
      return
    }
    if (num === q.options.length + 1) {
      e.preventDefault()
      otherInputRef.current?.focus()
      return
    }


    // Enter to submit
    if (e.key === 'Enter') {
      const allAnswered = questions.every(
        (q) => (selections[q.question] || otherTexts[q.question])
      )
      if (allAnswered) {
        e.preventDefault()
        const answers: Record<string, string> = {}
        for (const q of questions) {
          answers[q.question] = otherTexts[q.question] || selections[q.question] || ''
        }
        answerQuestion(pendingQuestion.requestId, answers)
        setSelections({})
        setOtherTexts({})
        setActiveTab(0)
      }
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
    setOtherTexts((s) => ({ ...s, [q.question]: text }))
    setSelections((s) => ({ ...s, [q.question]: '' }))
  }

  function handleSubmit() {
    const answers: Record<string, string> = {}
    for (const q of questions) {
      answers[q.question] = otherTexts[q.question] || selections[q.question] || ''
    }
    answerQuestion(requestId, answers)
    setSelections({})
    setOtherTexts({})
    setActiveTab(0)
  }

  const allAnswered = questions.every(
    (q) => (selections[q.question] || otherTexts[q.question])
  )

  const isAnswered = (q: UserQuestion) =>
    !!(selections[q.question] || otherTexts[q.question])

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
                key={q.question}
                onClick={() => setActiveTab(i)}
                className={`relative cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium transition ${
                  activeTab === i
                    ? 'bg-blue-600/15 text-blue-500'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {q.header}
                {isAnswered(q) && (
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
          <CommandShortcut className="ml-1.5 font-mono text-[10px] opacity-50">↵</CommandShortcut>
        </Button>
        <span className="text-[10px] text-muted-foreground">
          {!singleQuestion && 'tab switch · '}1-{questions[singleQuestion ? 0 : activeTab].options.length} select · {questions[singleQuestion ? 0 : activeTab].options.length + 1} other · esc dismiss
        </span>
      </div>
    </div>
  )
}
