import { useEffect, useRef } from 'react'
import { useChatStore } from '@/stores/chat'

const CHAT_INPUT_SELECTOR = '[data-chat-input-editor]'

export function useRestoreChatInputFocus(active: boolean): void {
  const wasFocusedRef = useRef(false)
  const prevActiveRef = useRef(false)
  const requestRestore = useChatStore((s) => s.requestChatInputFocusRestore)

  useEffect(() => {
    const prevActive = prevActiveRef.current
    prevActiveRef.current = active

    if (!prevActive && active) {
      const editorEl = document.querySelector(CHAT_INPUT_SELECTOR)
      wasFocusedRef.current = !!(editorEl && editorEl.contains(document.activeElement))
      return
    }

    if (prevActive && !active) {
      if (wasFocusedRef.current) requestRestore()
      wasFocusedRef.current = false
    }
  }, [active, requestRestore])
}
