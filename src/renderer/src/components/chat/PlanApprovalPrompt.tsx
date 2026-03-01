import { useRef, useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { useChatStore, useActiveSession } from '@/stores/chat'
import { Streamdown } from 'streamdown'
import { createCodePlugin } from '@streamdown/code'
import { createStreamdownCodeComponent } from './CodeBlock'
import { PenLine, Check, X } from 'lucide-react'
import { Kbd } from '@/components/ui/kbd'
import { streamdownLinkSafety } from './chat-shared'

const codePlugin = createCodePlugin({ themes: ['github-dark', 'github-dark'] })
const streamdownPlugins = { code: codePlugin }
const streamdownControls = { table: false }
const streamdownComponents = { code: createStreamdownCodeComponent(codePlugin) }

export function PlanApprovalPrompt() {
  const pending = useActiveSession((s) => s.pendingPlanApproval)
  const respond = useChatStore((s) => s.respondToPlanApproval)
  const [feedback, setFeedback] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const [isFeedbackFocused, setIsFeedbackFocused] = useState(false)
  const requestId = pending?.requestId
  const planContent = pending?.planContent ?? ''
  const planFilePath = pending?.planFilePath ?? ''
  const allowedPrompts = pending?.allowedPrompts ?? []
  const fileName = planFilePath.split('/').pop() ?? ''

  const handleApprove = useCallback(() => {
    if (!requestId) return
    respond(requestId, true)
  }, [requestId, respond])

  const handleReject = useCallback(() => {
    if (!requestId) return
    respond(requestId, false, feedback.trim() || undefined)
  }, [feedback, requestId, respond])

  const focusVisibleFeedbackInput = useCallback(() => {
    // Focus the visible input (desktop and narrow layouts both render one).
    const inputs = containerRef.current?.querySelectorAll<HTMLInputElement>('input[data-feedback]')
    for (const input of inputs ?? []) {
      if (input.offsetParent !== null) {
        input.focus()
        return
      }
    }
  }, [])

  useEffect(() => {
    if (!requestId) return

    function onKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return

      const active = document.activeElement
      const isFeedbackInputFocused =
        active instanceof HTMLInputElement &&
        active.dataset.feedback !== undefined &&
        containerRef.current?.contains(active)

      // Esc: blur feedback first, reject only when not in feedback
      if (e.key === 'Escape') {
        e.preventDefault()
        if (isFeedbackInputFocused) {
          ;(active as HTMLInputElement).blur()
          return
        }
        handleReject()
        return
      }

      // Tab: jump to feedback input
      if (e.key === 'Tab') {
        e.preventDefault()
        focusVisibleFeedbackInput()
        return
      }

      // Enter:
      // - in feedback input -> reject + submit
      // - otherwise -> approve
      if (e.key === 'Enter') {
        e.preventDefault()
        if (isFeedbackInputFocused) {
          handleReject()
          return
        }
        handleApprove()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [focusVisibleFeedbackInput, handleApprove, handleReject, requestId])

  if (!pending) return null

  return (
    <>
      {/* Takes over the main content area (flex-1) */}
      <div ref={containerRef} className="@container flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {/* Header */}
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
          <PenLine className="size-4 text-blue-400" />
          <span className="text-sm font-medium text-foreground">Review</span>
          {fileName && (
            <span className="text-sm text-muted-foreground">{fileName}</span>
          )}
        </div>

        {/* Plan content — scrollable, fills available space */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          <div className="p-4">
            <Streamdown
              className="chat-md"
              plugins={streamdownPlugins}
              components={streamdownComponents}
              controls={streamdownControls}
              linkSafety={streamdownLinkSafety}
            >
              {planContent}
            </Streamdown>
          </div>
        </div>

        {/* Footer — permissions + feedback + actions */}
        <div className="shrink-0 border-t border-border px-4 py-3 space-y-2">
          {allowedPrompts.length > 0 && (
            <div>
              <div className="mb-1 text-[10px] font-medium uppercase text-muted-foreground">
                Requested permissions
              </div>
              <div className="flex flex-wrap gap-1.5">
                {allowedPrompts.map((p, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
                  >
                    <span className="font-medium">{p.tool}</span>
                    <span>{p.prompt}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* @xl: [Approve] [Reject] [feedback] inline */}
          <div className="hidden items-center gap-2 @xl:flex">
            <Button
              size="sm"
              className="h-7 cursor-pointer gap-1 bg-green-600 px-3 text-xs text-white hover:bg-green-500"
              onClick={handleApprove}
            >
              <Check className="size-3" />
              Approve
              {!isFeedbackFocused && (
                <Kbd variant="inline" className="ml-1 text-green-200/80">↵</Kbd>
              )}
            </Button>
            <Button
              size="sm"
              className="h-7 cursor-pointer gap-1 bg-red-700 px-3 text-xs text-white hover:bg-red-600"
              onClick={handleReject}
            >
              <X className="size-3" />
              Reject
              <Kbd variant="inline" className="ml-1 text-red-200/80">{isFeedbackFocused ? '↵' : 'esc'}</Kbd>
            </Button>
            <div className="relative flex flex-1 items-center">
              <input
                data-feedback
                type="text"
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                onFocus={() => setIsFeedbackFocused(true)}
                onBlur={() => setIsFeedbackFocused(false)}
                placeholder="Reject feedback (optional, Enter to submit)"
                className="h-7 w-full rounded bg-muted px-2 pr-12 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <Kbd className="pointer-events-none absolute right-2">{isFeedbackFocused ? '↵' : '⇥'}</Kbd>
            </div>
          </div>

          {/* Narrow: feedback full-width, then both buttons */}
          <div className="space-y-2 @xl:hidden">
            <div className="relative flex items-center">
              <input
                data-feedback
                type="text"
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                onFocus={() => setIsFeedbackFocused(true)}
                onBlur={() => setIsFeedbackFocused(false)}
                placeholder="Reject feedback (optional, Enter to submit)"
                className="h-7 w-full rounded bg-muted px-2 pr-12 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <Kbd className="pointer-events-none absolute right-2">{isFeedbackFocused ? '↵' : '⇥'}</Kbd>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                className="h-7 flex-1 cursor-pointer gap-1 bg-green-600 px-3 text-xs text-white hover:bg-green-500"
                onClick={handleApprove}
              >
                <Check className="size-3" />
                Approve
                {!isFeedbackFocused && (
                  <Kbd variant="inline" className="ml-1 text-green-200/80">↵</Kbd>
                )}
              </Button>
              <Button
                size="sm"
                className="h-7 flex-1 cursor-pointer gap-1 bg-red-700 px-3 text-xs text-white hover:bg-red-600"
                onClick={handleReject}
              >
                <X className="size-3" />
                Reject
                {!isFeedbackFocused && (
                  <Kbd variant="inline" className="ml-1 text-red-200/80">esc</Kbd>
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
