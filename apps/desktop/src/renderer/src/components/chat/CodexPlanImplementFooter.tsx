import { useEffect, useRef, useState } from 'react'
import { Check, X } from 'lucide-react'
import { Button } from '@superone/ui/components/ui/button'
import { Kbd } from '@superone/ui/components/ui/kbd'
import { isFocusInChat, useChatRootRef } from './is-focus-in-chat'
import { PermissionFeedbackInput } from './PermissionActionBar'
import { PermissionActionsLayout } from './PermissionActionsLayout'

interface CodexPlanImplementFooterProps {
  onApprove: () => void
  onReject: (feedback?: string) => void
}

export function CodexPlanImplementFooter({ onApprove, onReject }: CodexPlanImplementFooterProps) {
  const [feedback, setFeedback] = useState('')
  const [isFeedbackFocused, setIsFeedbackFocused] = useState(false)
  const feedbackRef = useRef<HTMLTextAreaElement>(null)
  const chatRootRef = useChatRootRef()

  const submitReject = () => {
    onReject(feedback.trim() || undefined)
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (!isFocusInChat(document.activeElement, chatRootRef?.current)) return

      const active = document.activeElement
      const feedbackInput = feedbackRef.current
      const isFeedbackInputFocused = !!feedbackInput && active === feedbackInput

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
  }, [feedback, onApprove, onReject, chatRootRef])

  return (
    <PermissionActionsLayout feedbackValue={feedback} minInlineWidth={640} feedback={
      <PermissionFeedbackInput
        ref={feedbackRef}
        value={feedback}
        onChange={setFeedback}
        onFocusChange={setIsFeedbackFocused}
        placeholder="Reject feedback (optional, Enter to submit)"
        onSubmit={submitReject}
      />
    }>
      <Button
        size="sm"
        className="h-7 flex-1 cursor-pointer gap-1 bg-success px-3 text-xs text-success-foreground hover:bg-success/90 @xl:flex-none"
        onClick={onApprove}
      >
        <Check className="size-3" />
        Approve
        {!isFeedbackFocused && (
          <Kbd variant="inline" className="ml-1 text-success-foreground/70">↵</Kbd>
        )}
      </Button>
      <Button
        size="sm"
        className="h-7 flex-1 cursor-pointer gap-1 bg-destructive px-3 text-xs text-destructive-foreground hover:bg-destructive/90 @xl:flex-none"
        onClick={submitReject}
      >
        <X className="size-3" />
        Reject
        <Kbd variant="inline" className="ml-1 text-destructive-foreground/70">{isFeedbackFocused ? '↵' : 'esc'}</Kbd>
      </Button>
    </PermissionActionsLayout>
  )
}
