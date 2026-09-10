import { useEffect, useRef, type RefObject } from 'react'
import type { NativeComposerController } from '../ui/native-composer-input'

/** One tap owns preparation and sending, including asynchronous session creation. */
export function useComposerSend(
  editorRef: RefObject<NativeComposerController | null>,
  scope: unknown,
  send: () => Promise<void> | void,
  onError: (message: string) => void,
) {
  const active = useRef(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const currentScope = useRef(scope)
  currentScope.current = scope
  return async () => {
    if (active.current) return
    active.current = true
    const editor = editorRef.current
    try {
      await editor?.prepareSubmit()
      if (!mounted.current || currentScope.current !== scope) return
      await send()
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Message failed. Please try again.')
    } finally {
      active.current = false
    }
  }
}
