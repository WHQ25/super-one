import { useRef, useState, useEffect, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@superone/ui/components/ui/button'
import { useChatStore, useActiveSession, selectClaudeModels, selectClaudeAccount } from '@/stores/chat'
import { Streamdown } from 'streamdown'
import { createCodePlugin } from '@streamdown/code'
import { createStreamdownCodeComponent } from './CodeBlock'
import { PenLine, Check, X, FastForward, Zap, Circle, CheckCircle2 } from 'lucide-react'
import { Kbd } from '@superone/ui/components/ui/kbd'
import { streamdownLinkSafety, streamdownRehypePlugins, mathPlugin } from './chat-shared'
import { checkAutoModeEligibility } from '@/lib/auto-mode-eligibility'
import { useRestoreChatInputFocus } from '@/hooks/useRestoreChatInputFocus'
import type { PermissionMode } from '@superone/shared/agent-types'

const codePlugin = createCodePlugin({ themes: ['github-dark', 'github-dark'] })
const streamdownPlugins = { code: codePlugin, math: mathPlugin }
const streamdownControls = { table: false }
const streamdownComponents = { code: createStreamdownCodeComponent(codePlugin) }

export function PlanApprovalPrompt() {
  const { t } = useTranslation()
  const pending = useActiveSession((s) => s.pendingPlanApproval)
  const respond = useChatStore((s) => s.respondToPlanApproval)
  const account = useChatStore(selectClaudeAccount)
  const availableModels = useChatStore(selectClaudeModels)
  const selectedModel = useActiveSession((s) => s.selectedModel)
  const [feedback, setFeedback] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const [isFeedbackFocused, setIsFeedbackFocused] = useState(false)
  const [switchAfterApproval, setSwitchAfterApproval] = useState(false)
  const requestId = pending?.requestId
  useRestoreChatInputFocus(!!requestId)
  const planContent = pending?.planContent ?? ''
  const planFilePath = pending?.planFilePath ?? ''
  const allowedPrompts = pending?.allowedPrompts ?? []
  const fileName = planFilePath.split('/').pop() ?? ''

  const fastModeTarget: PermissionMode = useMemo(() => {
    const modelInfo = availableModels.find((m) => m.id === selectedModel)
    const elig = checkAutoModeEligibility({
      subscriptionType: account?.subscriptionType,
      apiProvider: account?.apiProvider,
      modelSupportsAutoMode: modelInfo?.supportsAutoMode,
    })
    return elig.ok ? 'auto' : 'acceptEdits'
  }, [account, availableModels, selectedModel])
  const isAutoTarget = fastModeTarget === 'auto'

  useEffect(() => {
    setFeedback('')
    setIsFeedbackFocused(false)
    setSwitchAfterApproval(false)
  }, [requestId])

  const handleApprove = useCallback(() => {
    if (!requestId) return
    respond(requestId, true, undefined, switchAfterApproval ? fastModeTarget : undefined)
  }, [requestId, respond, switchAfterApproval, fastModeTarget])

  const handleApproveFastMode = useCallback(() => {
    if (!requestId) return
    respond(requestId, true, undefined, fastModeTarget)
  }, [requestId, respond, fastModeTarget])

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
        handleApproveFastMode()
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
        setSwitchAfterApproval((prev) => !prev)
        return
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [focusVisibleFeedbackInput, handleApprove, handleApproveFastMode, handleReject, requestId])

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
            {switchAfterApproval ? (
              <Button
                size="sm"
                className={`h-7 cursor-pointer gap-1 px-3 text-xs text-white ${
                  isAutoTarget
                    ? 'bg-amber-600 hover:bg-amber-500'
                    : 'bg-purple-600 hover:bg-purple-500'
                }`}
                onClick={handleApprove}
              >
                {isAutoTarget ? <Zap className="size-3" /> : <FastForward className="size-3" />}
                {t(isAutoTarget ? 'chat.plan.approveAuto' : 'chat.plan.approveAccept')}
                {!isFeedbackFocused && (
                  <Kbd
                    variant="inline"
                    className={`ml-1 ${isAutoTarget ? 'text-amber-200/80' : 'text-purple-200/80'}`}
                  >↵</Kbd>
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
              {switchAfterApproval ? (
                <Button
                  size="sm"
                  className={`h-7 flex-1 cursor-pointer gap-1 px-3 text-xs text-white ${
                    isAutoTarget
                      ? 'bg-amber-600 hover:bg-amber-500'
                      : 'bg-purple-600 hover:bg-purple-500'
                  }`}
                  onClick={handleApprove}
                >
                  {isAutoTarget ? <Zap className="size-3" /> : <FastForward className="size-3" />}
                  {t(isAutoTarget ? 'chat.plan.approveAuto' : 'chat.plan.approveAccept')}
                  {!isFeedbackFocused && (
                    <Kbd
                      variant="inline"
                      className={`ml-1 ${isAutoTarget ? 'text-amber-200/80' : 'text-purple-200/80'}`}
                    >↵</Kbd>
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

          {/* Toggle: switch to a faster mode after approval (auto when supported, else acceptEdits) */}
          <button
            type="button"
            className={`flex h-7 w-full cursor-pointer items-center gap-1.5 rounded border px-2.5 text-[11px] transition-colors ${
              switchAfterApproval
                ? isAutoTarget
                  ? 'border-amber-500/50 bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 dark:text-amber-500'
                  : 'border-purple-500/50 bg-purple-500/10 text-purple-500 hover:bg-purple-500/20'
                : 'border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            }`}
            onClick={() => setSwitchAfterApproval((prev) => !prev)}
          >
            {switchAfterApproval
              ? <CheckCircle2 className={`size-3.5 shrink-0 ${isAutoTarget ? 'text-amber-600 dark:text-amber-400' : 'text-purple-600 dark:text-purple-400'}`} />
              : <Circle className="size-3.5 shrink-0 text-muted-foreground/40" />
            }
            <span className="flex min-w-0 items-center gap-1">
              <span>{t('chat.plan.switchTo')}</span>
              <span className={`inline-flex items-center gap-0.5 font-medium ${isAutoTarget ? 'text-amber-600 dark:text-amber-400' : 'text-purple-600 dark:text-purple-400'}`}>
                {isAutoTarget ? <Zap className="size-3" /> : <FastForward className="size-3" />}
                {t(isAutoTarget ? 'chat.plan.auto' : 'chat.plan.acceptEdits')}
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
