import { useRef, useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { useChatStore, useActiveSession } from '@/stores/chat'
import { Streamdown } from 'streamdown'
import { createCodePlugin } from '@streamdown/code'
import { createStreamdownCodeComponent } from './CodeBlock'
import { PenLine, Check, X, FastForward, Circle, CheckCircle2 } from 'lucide-react'
import { Kbd } from '@/components/ui/kbd'
import { streamdownLinkSafety, streamdownRehypePlugins, mathPlugin } from './chat-shared'

const codePlugin = createCodePlugin({ themes: ['github-dark', 'github-dark'] })
const streamdownPlugins = { code: codePlugin, math: mathPlugin }
const streamdownControls = { table: false }
const streamdownComponents = { code: createStreamdownCodeComponent(codePlugin) }

export function PlanApprovalPrompt() {
  const { t } = useTranslation()
  const pending = useActiveSession((s) => s.pendingPlanApproval)
  const respond = useChatStore((s) => s.respondToPlanApproval)
  const [feedback, setFeedback] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const [isFeedbackFocused, setIsFeedbackFocused] = useState(false)
  const [acceptEdits, setAcceptEdits] = useState(false)
  const requestId = pending?.requestId
  const planContent = pending?.planContent ?? ''
  const planFilePath = pending?.planFilePath ?? ''
  const allowedPrompts = pending?.allowedPrompts ?? []
  const fileName = planFilePath.split('/').pop() ?? ''

  useEffect(() => {
    setFeedback('')
    setIsFeedbackFocused(false)
    setAcceptEdits(false)
  }, [requestId])

  const handleApprove = useCallback(() => {
    if (!requestId) return
    respond(requestId, true, undefined, acceptEdits ? 'acceptEdits' : undefined)
  }, [requestId, respond, acceptEdits])

  const handleApproveAcceptEdits = useCallback(() => {
    if (!requestId) return
    respond(requestId, true, undefined, 'acceptEdits')
  }, [requestId, respond])

  const handleReject = useCallback(() => {
    if (!requestId) return
    respond(requestId, false, feedback.trim() || undefined)
  }, [feedback, requestId, respond])

  const focusVisibleFeedbackInput = useCallback(() => {
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

      if (e.key === 'Escape') {
        e.preventDefault()
        if (isFeedbackInputFocused) {
          ;(active as HTMLInputElement).blur()
          return
        }
        handleReject()
        return
      }

      if (e.key === 'Tab' && e.shiftKey) {
        e.preventDefault()
        e.stopImmediatePropagation()
        handleApproveAcceptEdits()
        return
      }

      if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault()
        focusVisibleFeedbackInput()
        return
      }

      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault()
        if (isFeedbackInputFocused) {
          handleReject()
          return
        }
        handleApprove()
        return
      }

      if (e.key === '1') {
        e.preventDefault()
        setAcceptEdits((prev) => !prev)
        return
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [focusVisibleFeedbackInput, handleApprove, handleApproveAcceptEdits, handleReject, requestId])

  if (!pending) return null

  return (
    <>
      <div ref={containerRef} className="@container flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
          <PenLine className="size-4 text-blue-600 dark:text-blue-400" />
          <span className="text-sm font-medium text-foreground">{t('chat.plan.review')}</span>
          {fileName && (
            <span className="text-sm text-muted-foreground">{fileName}</span>
          )}
        </div>

        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          <div className="p-4">
            <Streamdown
              className="chat-md"
              plugins={streamdownPlugins}
              rehypePlugins={streamdownRehypePlugins}
              components={streamdownComponents}
              controls={streamdownControls}
              linkSafety={streamdownLinkSafety}
            >
              {planContent}
            </Streamdown>
          </div>
        </div>

        <div className="shrink-0 border-t border-border px-4 py-3 space-y-2">
          {allowedPrompts.length > 0 && (
            <div>
              <div className="mb-1 text-[10px] font-medium uppercase text-muted-foreground">
                {t('chat.plan.requestedPermissions')}
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

          {/* @xl: inline layout */}
          <div className="hidden items-center gap-2 @xl:flex">
            {acceptEdits ? (
              <Button
                size="sm"
                className="h-7 cursor-pointer gap-1 bg-purple-600 px-3 text-xs text-white hover:bg-purple-500"
                onClick={handleApprove}
              >
                <FastForward className="size-3" />
                {t('chat.plan.approveAccept')}
                {!isFeedbackFocused && (
                  <Kbd variant="inline" className="ml-1 text-purple-200/80">↵</Kbd>
                )}
              </Button>
            ) : (
              <Button
                size="sm"
                className="h-7 cursor-pointer gap-1 bg-green-600 px-3 text-xs text-white hover:bg-green-500"
                onClick={handleApprove}
              >
                <Check className="size-3" />
                {t('chat.plan.approve')}
                {!isFeedbackFocused && (
                  <Kbd variant="inline" className="ml-1 text-green-200/80">↵</Kbd>
                )}
              </Button>
            )}
            <Button
              size="sm"
              className="h-7 cursor-pointer gap-1 bg-red-700 px-3 text-xs text-white hover:bg-red-600"
              onClick={handleReject}
            >
              <X className="size-3" />
              {t('chat.plan.reject')}
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
                placeholder={t('chat.plan.feedbackPlaceholder')}
                className="h-7 w-full rounded bg-muted px-2 pr-12 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <Kbd className="pointer-events-none absolute right-2">{isFeedbackFocused ? '↵' : '⇥'}</Kbd>
            </div>
          </div>

          {/* Narrow layout */}
          <div className="space-y-2 @xl:hidden">
            <div className="relative flex items-center">
              <input
                data-feedback
                type="text"
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                onFocus={() => setIsFeedbackFocused(true)}
                onBlur={() => setIsFeedbackFocused(false)}
                placeholder={t('chat.plan.feedbackPlaceholder')}
                className="h-7 w-full rounded bg-muted px-2 pr-12 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <Kbd className="pointer-events-none absolute right-2">{isFeedbackFocused ? '↵' : '⇥'}</Kbd>
            </div>
            <div className="flex items-center gap-2">
              {acceptEdits ? (
                <Button
                  size="sm"
                  className="h-7 flex-1 cursor-pointer gap-1 bg-purple-600 px-3 text-xs text-white hover:bg-purple-500"
                  onClick={handleApprove}
                >
                  <FastForward className="size-3" />
                  {t('chat.plan.approveAccept')}
                  {!isFeedbackFocused && (
                    <Kbd variant="inline" className="ml-1 text-purple-200/80">↵</Kbd>
                  )}
                </Button>
              ) : (
                <Button
                  size="sm"
                  className="h-7 flex-1 cursor-pointer gap-1 bg-green-600 px-3 text-xs text-white hover:bg-green-500"
                  onClick={handleApprove}
                >
                  <Check className="size-3" />
                  {t('chat.plan.approve')}
                  {!isFeedbackFocused && (
                    <Kbd variant="inline" className="ml-1 text-green-200/80">↵</Kbd>
                  )}
                </Button>
              )}
              <Button
                size="sm"
                className="h-7 flex-1 cursor-pointer gap-1 bg-red-700 px-3 text-xs text-white hover:bg-red-600"
                onClick={handleReject}
              >
                <X className="size-3" />
                {t('chat.plan.reject')}
                {!isFeedbackFocused && (
                  <Kbd variant="inline" className="ml-1 text-red-200/80">esc</Kbd>
                )}
              </Button>
            </div>
          </div>

          {/* Toggle: Accept Edits after approval */}
          <button
            type="button"
            className={`flex h-7 w-full cursor-pointer items-center gap-1.5 rounded border px-2.5 text-[11px] transition-colors ${
              acceptEdits
                ? 'border-purple-500/50 bg-purple-500/10 text-purple-500 hover:bg-purple-500/20'
                : 'border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            }`}
            onClick={() => setAcceptEdits((prev) => !prev)}
          >
            {acceptEdits
              ? <CheckCircle2 className="size-3.5 shrink-0 text-purple-600 dark:text-purple-400" />
              : <Circle className="size-3.5 shrink-0 text-muted-foreground/40" />
            }
            <span className="flex min-w-0 items-center gap-1">
              <span>{t('chat.plan.switchTo')}</span>
              <span className="inline-flex items-center gap-0.5 font-medium text-purple-600 dark:text-purple-400">
                <FastForward className="size-3" />
                {t('chat.plan.acceptEdits')}
              </span>
              <span>{t('chat.plan.afterApproval')}</span>
            </span>
            <Kbd variant="square" className="ml-auto">1</Kbd>
          </button>
        </div>
      </div>
    </>
  )
}
