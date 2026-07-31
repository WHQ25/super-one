import { useRef, useState, useEffect, useCallback, useMemo, useId } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@superone/ui/components/ui/button'
import { useChatStore, useActiveSession, selectClaudeModels, selectClaudeAccount } from '@/stores/chat'
import { PenLine, Check, X, FastForward, Zap, Circle, CheckCircle2 } from 'lucide-react'
import { Kbd } from '@superone/ui/components/ui/kbd'
import { checkAutoModeEligibility } from '@/lib/auto-mode-eligibility'
import { useRestoreChatInputFocus } from '@/hooks/useRestoreChatInputFocus'
import type { PermissionMode } from '@superone/shared/agent-types'
import {
  formatApprovedPlanReviewMessage,
  formatPlanFeedback,
  type PlanLineComment,
} from './plan-feedback'
import { PlanLineReview } from './PlanLineReview'
import { isFocusInChat } from './is-focus-in-chat'

export function PlanApprovalPrompt() {
  const { t } = useTranslation()
  const pending = useActiveSession((s) => s.pendingPlanApproval)
  const sessionProvider = useActiveSession((s) => s.sessionProvider)
  const respond = useChatStore((s) => s.respondToPlanApproval)
  const sendMessage = useChatStore((s) => s.sendMessage)
  const account = useChatStore(selectClaudeAccount)
  const availableModels = useChatStore(selectClaudeModels)
  const selectedModel = useActiveSession((s) => s.selectedModel)
  const [freeform, setFreeform] = useState('')
  const [comments, setComments] = useState<PlanLineComment[]>([])
  const containerRef = useRef<HTMLDivElement>(null)
  const [isFeedbackFocused, setIsFeedbackFocused] = useState(false)
  const [switchAfterApproval, setSwitchAfterApproval] = useState(false)
  const requestId = pending?.requestId
  const idPrefix = useId()
  useRestoreChatInputFocus(!!requestId)
  const planContent = pending?.planContent ?? ''
  const planFilePath = pending?.planFilePath ?? ''
  const allowedPrompts = pending?.allowedPrompts ?? []
  const fileName = planFilePath.split('/').pop() ?? ''

  /** Grok/ACP: approve may carry review comments via a follow-up user turn. Claude: reject only. */
  const approveCanCarryFeedback = sessionProvider === 'acp'
  /** Claude-only post-approve permission switch. */
  const showPostApprovalModeToggle = sessionProvider === 'claude' || sessionProvider == null

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
    setFreeform('')
    setComments([])
    setIsFeedbackFocused(false)
    setSwitchAfterApproval(false)
  }, [requestId])

  const composedFeedback = useCallback(
    () => formatPlanFeedback(planContent, comments, freeform),
    [planContent, comments, freeform],
  )

  const handleApprove = useCallback(() => {
    if (!requestId) return
    const feedback = composedFeedback()
    const postMode = showPostApprovalModeToggle && switchAfterApproval ? fastModeTarget : undefined
    respond(requestId, true, undefined, postMode)
    if (approveCanCarryFeedback && feedback) {
      const msg = formatApprovedPlanReviewMessage(feedback)
      if (msg) void sendMessage(msg)
    }
  }, [
    requestId,
    composedFeedback,
    showPostApprovalModeToggle,
    switchAfterApproval,
    fastModeTarget,
    respond,
    approveCanCarryFeedback,
    sendMessage,
  ])

  const handleApproveFastMode = useCallback(() => {
    if (!requestId || !showPostApprovalModeToggle) {
      handleApprove()
      return
    }
    const feedback = composedFeedback()
    respond(requestId, true, undefined, fastModeTarget)
    if (approveCanCarryFeedback && feedback) {
      const msg = formatApprovedPlanReviewMessage(feedback)
      if (msg) void sendMessage(msg)
    }
  }, [
    requestId,
    showPostApprovalModeToggle,
    handleApprove,
    composedFeedback,
    respond,
    fastModeTarget,
    approveCanCarryFeedback,
    sendMessage,
  ])

  const handleReject = useCallback(() => {
    if (!requestId) return
    const feedback = composedFeedback()
    respond(requestId, false, feedback || undefined)
  }, [composedFeedback, requestId, respond])

  const focusVisibleFeedbackInput = useCallback(() => {
    const inputs = containerRef.current?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      'input[data-feedback], textarea[data-feedback]',
    )
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
      if (!isFocusInChat()) return

      const active = document.activeElement
      const inPrompt = !!(active && containerRef.current?.contains(active))
      const isTextField =
        active instanceof HTMLInputElement
        || active instanceof HTMLTextAreaElement
      const isFeedbackInputFocused =
        isTextField
        && inPrompt
        && (active as HTMLElement).dataset.feedback !== undefined
      const isDraftInputFocused =
        isTextField
        && inPrompt
        && (active as HTMLElement).dataset.planDraft !== undefined

      // Draft / line-review keys are handled by PlanLineReview (capture phase).
      if (isDraftInputFocused) return

      if (e.key === 'Escape') {
        e.preventDefault()
        if (isFeedbackInputFocused) {
          ;(active as HTMLElement).blur()
          return
        }
        handleReject()
        return
      }

      if (e.key === 'Tab' && e.shiftKey && showPostApprovalModeToggle) {
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
        if (isFeedbackInputFocused) {
          e.preventDefault()
          handleReject()
          return
        }
        if (!isTextField) {
          e.preventDefault()
          handleApprove()
        }
        return
      }

      if (e.key === '1' && showPostApprovalModeToggle && !isTextField) {
        e.preventDefault()
        setSwitchAfterApproval((prev) => !prev)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    focusVisibleFeedbackInput,
    handleApprove,
    handleApproveFastMode,
    handleReject,
    requestId,
    showPostApprovalModeToggle,
  ])

  if (!pending) return null

  const freeformPlaceholder = approveCanCarryFeedback
    ? t('chat.plan.feedbackPlaceholderBoth')
    : t('chat.plan.feedbackPlaceholder')

  return (
    <div ref={containerRef} className="@container flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
        <PenLine className="size-4 text-primary" />
        <span className="text-sm font-medium text-foreground">{t('chat.plan.review')}</span>
        {fileName && (
          <span className="text-sm text-muted-foreground">{fileName}</span>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {t('chat.plan.commentHint')}
        </span>
      </div>

      <PlanLineReview
        planContent={planContent}
        comments={comments}
        onCommentsChange={setComments}
        idPrefix={idPrefix}
      />

      <div className="shrink-0 space-y-2 border-t border-border px-4 py-3">
        {allowedPrompts.length > 0 && (
          <div>
            <div className="mb-1 text-xs font-medium uppercase text-muted-foreground">
              {t('chat.plan.requestedPermissions')}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {allowedPrompts.map((p, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                >
                  <span className="font-medium">{p.tool}</span>
                  <span>{p.prompt}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="hidden items-center gap-2 @xl:flex">
          <ApproveButton
            switchAfterApproval={switchAfterApproval && showPostApprovalModeToggle}
            isAutoTarget={isAutoTarget}
            showKbd={!isFeedbackFocused}
            onClick={handleApprove}
          />
          <RejectButton showKbd showEnterWhenFocused={isFeedbackFocused} onClick={handleReject} />
          <div className="relative flex flex-1 items-center">
            <input
              data-feedback
              type="text"
              value={freeform}
              onChange={(e) => setFreeform(e.target.value)}
              onFocus={() => setIsFeedbackFocused(true)}
              onBlur={() => setIsFeedbackFocused(false)}
              placeholder={freeformPlaceholder}
              className="h-7 w-full rounded bg-muted px-2 pr-12 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <Kbd className="pointer-events-none absolute right-2">{isFeedbackFocused ? '↵' : '⇥'}</Kbd>
          </div>
        </div>

        <div className="space-y-2 @xl:hidden">
          <div className="relative flex items-center">
            <input
              data-feedback
              type="text"
              value={freeform}
              onChange={(e) => setFreeform(e.target.value)}
              onFocus={() => setIsFeedbackFocused(true)}
              onBlur={() => setIsFeedbackFocused(false)}
              placeholder={freeformPlaceholder}
              className="h-7 w-full rounded bg-muted px-2 pr-12 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <Kbd className="pointer-events-none absolute right-2">{isFeedbackFocused ? '↵' : '⇥'}</Kbd>
          </div>
          <div className="flex items-center gap-2">
            <ApproveButton
              className="flex-1"
              switchAfterApproval={switchAfterApproval && showPostApprovalModeToggle}
              isAutoTarget={isAutoTarget}
              showKbd={false}
              onClick={handleApprove}
            />
            <RejectButton className="flex-1" showKbd={false} onClick={handleReject} />
          </div>
        </div>

        {showPostApprovalModeToggle && (
          <button
            type="button"
            className={`flex h-7 w-full cursor-pointer items-center gap-1.5 rounded border px-2.5 text-xs transition-colors ${
              switchAfterApproval
                ? isAutoTarget
                  ? 'border-amber-500/50 bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 dark:text-amber-500'
                  : 'border-purple-500/50 bg-purple-500/10 text-purple-600 hover:bg-purple-500/20 dark:text-purple-400'
                : isAutoTarget
                  ? 'border-border text-muted-foreground hover:bg-amber-500/10'
                  : 'border-border text-muted-foreground hover:bg-purple-500/10'
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
        )}
      </div>
    </div>
  )
}

function ApproveButton({
  switchAfterApproval,
  isAutoTarget,
  showKbd,
  onClick,
  className = '',
}: {
  switchAfterApproval: boolean
  isAutoTarget: boolean
  showKbd: boolean
  onClick: () => void
  className?: string
}) {
  const { t } = useTranslation()
  if (switchAfterApproval) {
    return (
      <Button
        size="sm"
        className={`h-7 cursor-pointer gap-1 px-3 text-xs text-white ${className} ${
          isAutoTarget
            ? 'bg-amber-600 hover:bg-amber-500'
            : 'bg-purple-600 hover:bg-purple-500'
        }`}
        onClick={onClick}
      >
        {isAutoTarget ? <Zap className="size-3" /> : <FastForward className="size-3" />}
        {t(isAutoTarget ? 'chat.plan.approveAuto' : 'chat.plan.approveAccept')}
        {showKbd && (
          <Kbd
            variant="inline"
            className={`ml-1 ${isAutoTarget ? 'text-amber-200/80' : 'text-purple-200/80'}`}
          >↵</Kbd>
        )}
      </Button>
    )
  }
  return (
    <Button
      size="sm"
      className={`h-7 cursor-pointer gap-1 bg-success px-3 text-xs text-success-foreground hover:bg-success/90 ${className}`}
      onClick={onClick}
    >
      <Check className="size-3" />
      {t('chat.plan.approve')}
      {showKbd && (
        <Kbd variant="inline" className="ml-1 text-success-foreground/70">↵</Kbd>
      )}
    </Button>
  )
}

function RejectButton({
  showKbd,
  showEnterWhenFocused = false,
  onClick,
  className = '',
}: {
  showKbd: boolean
  showEnterWhenFocused?: boolean
  onClick: () => void
  className?: string
}) {
  const { t } = useTranslation()
  return (
    <Button
      size="sm"
      className={`h-7 cursor-pointer gap-1 bg-destructive px-3 text-xs text-destructive-foreground hover:bg-destructive/90 ${className}`}
      onClick={onClick}
    >
      <X className="size-3" />
      {t('chat.plan.reject')}
      {showKbd && (
        <Kbd variant="inline" className="ml-1 text-destructive-foreground/70">
          {showEnterWhenFocused ? '↵' : 'esc'}
        </Kbd>
      )}
    </Button>
  )
}
