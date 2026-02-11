import { useRef, useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { useChatStore, useActiveSession } from '@/stores/chat'
import { Streamdown } from 'streamdown'
import { createCodePlugin } from '@streamdown/code'
import { createStreamdownCodeComponent } from './CodeBlock'
import { PenLine, Check, X } from 'lucide-react'

const codePlugin = createCodePlugin({ themes: ['github-dark', 'github-dark'] })
const streamdownPlugins = { code: codePlugin }
const streamdownControls = { table: false }
const streamdownComponents = { code: createStreamdownCodeComponent(codePlugin) }

export function PlanApprovalPrompt() {
  const pending = useActiveSession((s) => s.pendingPlanApproval)
  const respond = useChatStore((s) => s.respondToPlanApproval)
  const [feedback, setFeedback] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  // Tab to focus the visible feedback input
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const active = document.activeElement
        if (active?.tagName === 'INPUT' && containerRef.current?.contains(active)) return
        e.preventDefault()
        // Focus the visible input (the one not inside a hidden parent)
        const inputs = containerRef.current?.querySelectorAll<HTMLInputElement>('input[data-feedback]')
        for (const input of inputs ?? []) {
          if (input.offsetParent !== null) { input.focus(); break }
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  if (!pending) return null

  const { requestId, planContent, planFilePath, allowedPrompts } = pending

  const fileName = planFilePath.split('/').pop() ?? ''

  function handleApprove() {
    respond(requestId, true)
  }

  function handleReject() {
    respond(requestId, false, feedback.trim() || undefined)
  }

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
              className="h-7 w-[100px] cursor-pointer gap-1 bg-green-600 text-xs text-white hover:bg-green-500"
              onClick={handleApprove}
            >
              <Check className="size-3" />
              Approve
            </Button>
            <Button
              size="sm"
              variant="destructive"
              className="h-7 w-[100px] cursor-pointer gap-1 text-xs"
              onClick={handleReject}
            >
              <X className="size-3" />
              Reject
            </Button>
            <div className="relative flex flex-1 items-center">
              <input
                data-feedback
                type="text"
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="Reject feedback (optional)"
                className="h-7 w-full rounded bg-muted px-2 pr-12 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <kbd className="pointer-events-none absolute right-2 rounded bg-background/60 px-1 py-0.5 text-[10px] text-muted-foreground">Tab</kbd>
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
                placeholder="Reject feedback (optional)"
                className="h-7 w-full rounded bg-muted px-2 pr-12 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <kbd className="pointer-events-none absolute right-2 rounded bg-background/60 px-1 py-0.5 text-[10px] text-muted-foreground">Tab</kbd>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                className="h-7 flex-1 cursor-pointer gap-1 bg-green-600 text-xs text-white hover:bg-green-500"
                onClick={handleApprove}
              >
                <Check className="size-3" />
                Approve
              </Button>
              <Button
                size="sm"
                variant="destructive"
                className="h-7 flex-1 cursor-pointer gap-1 text-xs"
                onClick={handleReject}
              >
                <X className="size-3" />
                Reject
              </Button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
