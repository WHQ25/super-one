import { useCallback, useEffect, useRef, useState } from 'react'
import { Keyboard } from 'react-native'

/**
 * A fullscreen MCP App View owns the chat screen: the header becomes the View's and the
 * composer steps aside until the header brings it back. The View itself stays in the chat
 * WebView, so entering and leaving never reloads it; this only tracks the native chrome.
 */
export function useMcpAppFullscreen(streaming: boolean) {
  const [view, setView] = useState<{ title: string } | null>(null)
  const [composerOpen, setComposerOpen] = useState(false)
  const [unread, setUnread] = useState(false)
  const wasStreaming = useRef(streaming)

  // The transcript is out of sight, so a turn that ends while the composer is away
  // leaves a mark on the toggle until the user looks.
  useEffect(() => {
    if (wasStreaming.current && !streaming && view && !composerOpen) setUnread(true)
    wasStreaming.current = streaming
  }, [streaming, view, composerOpen])

  /**
   * The View went fullscreen (or back, `null`); each entry starts with the composer away.
   * Leaving keeps the keyboard: the composer it belongs to stays on screen.
   */
  const show = useCallback((next: { title: string } | null) => {
    setView(next)
    setComposerOpen(false)
    setUnread(false)
    if (next) Keyboard.dismiss()
  }, [])

  const toggleComposer = useCallback(() => {
    setUnread(false)
    if (composerOpen) Keyboard.dismiss()
    setComposerOpen(!composerOpen)
  }, [composerOpen])

  /** A message went out from the fullscreen composer: hand the screen back to the View. */
  const closeComposer = useCallback(() => {
    if (!view) return
    setComposerOpen(false)
    Keyboard.dismiss()
  }, [view])

  return { view, composerOpen, unread, show, toggleComposer, closeComposer }
}
