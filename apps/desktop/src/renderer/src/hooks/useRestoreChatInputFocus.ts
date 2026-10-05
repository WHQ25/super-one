import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { useChatStore, type SessionWriteTarget } from '@/stores/chat'
import { noteChatInputFocused } from '@/components/chat/composer-slot/decision-composer-policy'

const CHAT_INPUT_SELECTOR = '[data-chat-input-editor]'

export function useRestoreChatInputFocus(
  active: boolean,
  chatRootRef: RefObject<HTMLElement | null>,
  target?: SessionWriteTarget,
): { autoFocusOnMount: boolean; onBaseComposerMounted: () => void } {
  const wasFocusedRef = useRef(false)
  const editorFocusedRef = useRef(false)
  const activeRef = useRef(active)
  activeRef.current = active
  const prevActiveRef = useRef(false)
  const projectPath = target?.projectPath
  const sessionId = target?.sessionId
  const identity = target ? `${projectPath}\0${sessionId}` : null
  const previousIdentityRef = useRef(identity)
  const restoreOnMountRef = useRef<{ identity: string | null } | null>(null)
  const [autoFocusOnMount, setAutoFocusOnMount] = useState(true)
  const requestRestore = useChatStore((s) => s.requestChatInputFocusRestore)

  useEffect(() => {
    const root = chatRootRef.current
    if (!root) return
    const editor = root.querySelector(CHAT_INPUT_SELECTOR)
    editorFocusedRef.current = !!editor?.contains(document.activeElement)
    const onFocusIn = (event: FocusEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(CHAT_INPUT_SELECTOR)) return
      editorFocusedRef.current = true
      noteChatInputFocused(root)
    }
    const onFocusOut = (event: FocusEvent) => {
      if (!activeRef.current && event.target instanceof Element && event.target.closest(CHAT_INPUT_SELECTOR) && event.target.isConnected) {
        editorFocusedRef.current = false
      }
    }
    root.addEventListener('focusin', onFocusIn)
    root.addEventListener('focusout', onFocusOut)
    return () => {
      root.removeEventListener('focusin', onFocusIn)
      root.removeEventListener('focusout', onFocusOut)
    }
  }, [chatRootRef, identity])

  useEffect(() => {
    if (previousIdentityRef.current !== identity) {
      previousIdentityRef.current = identity
      wasFocusedRef.current = false
      editorFocusedRef.current = false
      restoreOnMountRef.current = null
      prevActiveRef.current = active
      setAutoFocusOnMount(!active)
      return
    }
    const prevActive = prevActiveRef.current
    prevActiveRef.current = active

    if (!prevActive && active) {
      const editorEl = chatRootRef.current?.querySelector(CHAT_INPUT_SELECTOR)
      // Full-screen plan review removes the editor in this commit. Preserve the
      // focus captured before removal as well as the animated slot's live focus.
      wasFocusedRef.current = editorFocusedRef.current || !!editorEl?.contains(document.activeElement)
      editorFocusedRef.current = false
      if (wasFocusedRef.current && chatRootRef.current) noteChatInputFocused(chatRootRef.current)
      // The composer slot is about to unmount ChatInput. Its next mount should
      // restore focus only when this transition actually displaced the caret.
      setAutoFocusOnMount(false)
      return
    }

    if (prevActive && !active) {
      if (wasFocusedRef.current) restoreOnMountRef.current = { identity }
      wasFocusedRef.current = false
    }
  }, [active, chatRootRef, identity])

  const onBaseComposerMounted = useCallback(() => {
    if (restoreOnMountRef.current?.identity === identity) {
      restoreOnMountRef.current = null
      requestRestore(projectPath && sessionId ? { projectPath, sessionId } : undefined)
    }
    setAutoFocusOnMount(true)
  }, [identity, projectPath, sessionId, requestRestore])

  return { autoFocusOnMount, onBaseComposerMounted }
}
