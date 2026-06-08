import { useEffect, useRef, useState } from 'react'
import { Check, X } from 'lucide-react'
import { Button } from '@superone/ui/components/ui/button'
import { Kbd } from '@superone/ui/components/ui/kbd'

interface CodexPlanImplementFooterProps {
  onApprove: () => void
  onReject: (feedback?: string) => void
}

export function CodexPlanImplementFooter({ onApprove, onReject }: CodexPlanImplementFooterProps) {
  const [feedback, setFeedback] = useState('')
  const [isFeedbackFocused, setIsFeedbackFocused] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const feedbackRef = useRef<HTMLInputElement>(null)

  const submitReject = () => {
    onReject(feedback.trim() || undefined)
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return

      const active = document.activeElement
      const feedbackInput = feedbackRef.current
      const isFeedbackInputFocused = !!feedbackInput && active === feedbackInput
      const isInsideFooter = !!(active instanceof HTMLElement && containerRef.current?.contains(active))
      const isEditable = active instanceof HTMLInputElement
        || active instanceof HTMLTextAreaElement
        || (active instanceof HTMLElement && active.isContentEditable)
      const editableText = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
        ? active.value
        : active instanceof HTMLElement
          ? active.textContent ?? ''
          : ''
      if (isEditable && !isInsideFooter && editableText.trim().length > 0) {
        return
      }

      if (e.key === 'Tab') {
        e.preventDefault()
        feedbackInput?.focus()
        return
      }

      if (e.key === 'Escape') {
        e.preventDefault()
        submitReject()
        return
      }

      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault()
        if (isFeedbackInputFocused) {
          submitReject()
          return
        }
        onApprove()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [feedback, onApprove, onReject])

  return (
    <div ref={containerRef} className="flex w-full flex-col gap-2 @xl:flex-row @xl:items-center">
      <div className="relative order-1 flex items-center @xl:order-3 @xl:flex-1">
        <input
          ref={feedbackRef}
          data-feedback
          type="text"
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          onFocus={() => setIsFeedbackFocused(true)}
          onBlur={() => setIsFeedbackFocused(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !(e.nativeEvent as KeyboardEvent).isComposing) {
              e.preventDefault()
              submitReject()
            }
          }}
          placeholder="Reject feedback (optional, Enter to submit)"
          className="h-7 w-full rounded bg-muted px-2 pr-12 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <Kbd className="pointer-events-none absolute right-2">{isFeedbackFocused ? '↵' : '⇥'}</Kbd>
      </div>
      <div className="order-2 flex items-center gap-2 @xl:order-1">
        <Button
          size="sm"
          className="h-7 flex-1 cursor-pointer gap-1 bg-green-600 px-3 text-xs text-white hover:bg-green-500 @xl:flex-none"
          onClick={onApprove}
        >
          <Check className="size-3" />
          Approve
          {!isFeedbackFocused && (
            <Kbd variant="inline" className="ml-1 text-green-200/80">↵</Kbd>
          )}
        </Button>
        <Button
          size="sm"
          className="h-7 flex-1 cursor-pointer gap-1 bg-red-700 px-3 text-xs text-white hover:bg-red-600 @xl:flex-none"
          onClick={submitReject}
        >
          <X className="size-3" />
          Reject
          <Kbd variant="inline" className="ml-1 text-red-200/80">{isFeedbackFocused ? '↵' : 'esc'}</Kbd>
        </Button>
      </div>
    </div>
  )
}
