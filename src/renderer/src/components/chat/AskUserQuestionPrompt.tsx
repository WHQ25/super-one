import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { useChatStore, useActiveSession } from '@/stores/chat'
import type { UserQuestion } from '../../../../shared/agent-types'

export function AskUserQuestionPrompt() {
  const pendingQuestion = useActiveSession((s) => s.pendingQuestion)
  const answerQuestion = useChatStore((s) => s.answerQuestion)
  const dismissQuestion = useChatStore((s) => s.dismissQuestion)

  const [selections, setSelections] = useState<Record<string, string>>({})
  const [otherTexts, setOtherTexts] = useState<Record<string, string>>({})

  const handleEsc = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape' && pendingQuestion) {
      e.preventDefault()
      dismissQuestion(pendingQuestion.requestId)
      setSelections({})
      setOtherTexts({})
    }
  }, [pendingQuestion, dismissQuestion])

  useEffect(() => {
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [handleEsc])

  if (!pendingQuestion) return null

  const { requestId, questions } = pendingQuestion

  function selectOption(q: UserQuestion, label: string) {
    if (q.multiSelect) {
      // Toggle selection
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
  }

  function setOther(q: UserQuestion, text: string) {
    setOtherTexts((s) => ({ ...s, [q.question]: text }))
    setSelections((s) => ({ ...s, [q.question]: '' }))
  }

  function handleSubmit() {
    const answers: Record<string, string> = {}
    for (const q of questions) {
      const other = otherTexts[q.question]
      answers[q.question] = other || selections[q.question] || ''
    }
    answerQuestion(requestId, answers)
    setSelections({})
    setOtherTexts({})
  }

  const allAnswered = questions.every(
    (q) => (selections[q.question] || otherTexts[q.question])
  )

  return (
    <div className="mx-3 mb-2 space-y-3 rounded-lg border border-blue-600/40 bg-muted/60 p-3">
      {questions.map((q) => (
        <div key={q.question}>
          <p className="mb-1.5 text-xs font-medium text-foreground">{q.question}</p>
          <div className="flex flex-wrap gap-1.5">
            {q.options.map((opt) => {
              const selected = q.multiSelect
                ? (selections[q.question] ?? '').split(', ').includes(opt.label)
                : selections[q.question] === opt.label
              return (
                <button
                  key={opt.label}
                  onClick={() => selectOption(q, opt.label)}
                  className={`cursor-pointer rounded px-2 py-1 text-xs transition ${
                    selected
                      ? 'bg-blue-600 text-white'
                      : 'bg-muted text-foreground hover:bg-accent'
                  }`}
                  title={opt.description}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
          <input
            type="text"
            placeholder="Other..."
            value={otherTexts[q.question] ?? ''}
            onChange={(e) => setOther(q, e.target.value)}
            className="mt-1.5 w-full rounded bg-muted px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      ))}
      <Button
        size="sm"
        disabled={!allAnswered}
        className="h-7 cursor-pointer bg-blue-600 px-4 text-xs text-white hover:bg-blue-500 disabled:opacity-50"
        onClick={handleSubmit}
      >
        Submit
      </Button>
    </div>
  )
}
