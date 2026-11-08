import { useEffect, type MutableRefObject, type RefObject } from 'react'
import type { TerminalCommandRuleScope } from '@superone/shared/terminal-command-rules'
import { canAutofocusInChatRoot, isFocusInChat } from '../is-focus-in-chat'
import { leaveDecisionField, shouldSuppressDecisionShortcut, wasChatInputFocusedRecently } from '../composer-slot/decision-composer-policy'

export function usePermissionPromptKeyboard({
  requestId,
  isCollapsed,
  setIsCollapsed,
  isSelfManagedConfirm,
  chatRootRef,
  defaultToNo,
  isCodexDecisionPrompt,
  hasAlwaysButton,
  hasScopedAlways,
  rememberPreview,
  isScopedPermission,
  isEditTool,
  btnCount,
  btnRefs,
  feedbackRef,
  setFocusedIdx,
  terminalRule,
  toggleRememberRule,
  suggestionsCount,
  toggleSuggestion,
  handleAllow,
  handleAlwaysAllow,
  handleDeny,
  handleAcceptEdit,
}: {
  requestId: string | undefined
  isCollapsed: boolean
  setIsCollapsed: (collapsed: boolean) => void
  isSelfManagedConfirm: boolean
  chatRootRef: RefObject<HTMLElement | null> | null
  defaultToNo: boolean
  isCodexDecisionPrompt: boolean
  hasAlwaysButton: boolean
  hasScopedAlways: boolean
  rememberPreview: boolean
  isScopedPermission: boolean
  isEditTool: boolean
  btnCount: number
  btnRefs: MutableRefObject<(HTMLButtonElement | null)[]>
  feedbackRef: RefObject<HTMLTextAreaElement | null>
  setFocusedIdx: (updater: number | ((prev: number) => number)) => void
  terminalRule: string | null
  toggleRememberRule: (scope: TerminalCommandRuleScope) => void
  suggestionsCount: number
  toggleSuggestion: (idx: number) => void
  handleAllow: () => void
  handleAlwaysAllow: () => void
  handleDeny: () => void
  handleAcceptEdit: () => void
}) {
  useEffect(() => {
    // Self-managed confirms own their focus — this autofocus effect must not fight them.
    // Also skip when another mosaic chat pane owns keyboard focus so a background
    // session's permission prompt cannot steal the composer caret.
    if (requestId && !isCollapsed && !isSelfManagedConfirm) {
      requestAnimationFrame(() => {
        if (!canAutofocusInChatRoot(chatRootRef?.current) || wasChatInputFocusedRecently(chatRootRef?.current)) return
        // Deny sits at index 1 on the standard row (index 2 when device-control adds
        // its always-allow button between approve and reject).
        const denyIdx = hasAlwaysButton ? 2 : 1
        const initialIdx = defaultToNo && !isCodexDecisionPrompt ? denyIdx : 0
        btnRefs.current[initialIdx]?.focus()
        setFocusedIdx(initialIdx)
      })
    }
  }, [requestId, isCollapsed, isSelfManagedConfirm, chatRootRef, defaultToNo, isCodexDecisionPrompt, hasAlwaysButton, btnRefs, setFocusedIdx])

  useEffect(() => {
    // Self-managed confirms own their keys (the video composer's prompt submits on
    // Enter). Without this gate Enter/Escape would additionally trigger
    // handleAllow/handleDeny here with the wrong payload.
    if (!requestId || isSelfManagedConfirm) return

    function onKeyDown(e: KeyboardEvent) {
      // Enter/Esc/Space/digits must not fire while the user types in another panel
      // or in a sibling mosaic chat pane.
      if (!isFocusInChat(document.activeElement, chatRootRef?.current)) return
      if (shouldSuppressDecisionShortcut(e, chatRootRef?.current)) return
      if (isScopedPermission && e.key === 'Enter' && e.repeat) { e.preventDefault(); return }
      const submitScopedChoice = () => {
        if (document.activeElement === btnRefs.current[hasAlwaysButton ? 2 : 1]) handleDeny()
        else if (hasScopedAlways && !rememberPreview && document.activeElement === btnRefs.current[1]) handleAlwaysAllow()
        else handleAllow()
      }

      if (isCollapsed) {
        if (e.key === ' ') {
          e.preventDefault()
          setIsCollapsed(false)
        }
        return
      }

      if (e.key === 'Tab' && e.shiftKey && isEditTool && !isCodexDecisionPrompt) {
        e.preventDefault()
        e.stopImmediatePropagation()
        handleAcceptEdit()
        return
      }

      if (!isCodexDecisionPrompt && document.activeElement === feedbackRef.current) {
        if (e.key === 'Enter' && !e.isComposing) {
          e.preventDefault()
          handleDeny()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          leaveDecisionField(feedbackRef.current)
        }
        return
      }

      if (e.key === ' ') {
        e.preventDefault()
        setIsCollapsed(true)
        return
      }

      if ((isCodexDecisionPrompt || hasAlwaysButton) && e.key === 'Enter' && e.shiftKey && !e.isComposing) {
        e.preventDefault()
        handleAlwaysAllow()
        return
      }
      if (isScopedPermission && e.key === 'Enter' && e.shiftKey) { e.preventDefault(); return }

      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault()
        if (defaultToNo && !isCodexDecisionPrompt) handleDeny()
        else if (isScopedPermission) submitScopedChoice()
        else handleAllow()
        return
      }

      if (e.key === 'Escape') {
        e.preventDefault()
        handleDeny()
        return
      }

      if (terminalRule && (e.key === '1' || e.key === '2')) {
        e.preventDefault()
        toggleRememberRule(e.key === '1' ? 'session' : 'project')
        return
      }

      if (e.key >= '1' && e.key <= '9') {
        const idx = parseInt(e.key) - 1
        if (idx < suggestionsCount) {
          e.preventDefault()
          toggleSuggestion(idx)
        }
        return
      }

      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        const delta = e.key === 'ArrowLeft' ? -1 : 1
        setFocusedIdx((prev) => {
          const next = Math.max(0, Math.min(btnCount - 1, prev + delta))
          btnRefs.current[next]?.focus()
          return next
        })
        return
      }

      if (!isCodexDecisionPrompt && e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        feedbackRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [requestId, btnCount, handleDeny, handleAcceptEdit, handleAllow, handleAlwaysAllow, isCodexDecisionPrompt, hasAlwaysButton, hasScopedAlways, rememberPreview, isScopedPermission, isEditTool, isCollapsed, setIsCollapsed, suggestionsCount, toggleSuggestion, isSelfManagedConfirm, chatRootRef, defaultToNo, terminalRule, toggleRememberRule, btnRefs, feedbackRef, setFocusedIdx])
}
