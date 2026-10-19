import { useEffect } from 'react'
import { AppState } from 'react-native'
import type { ChatRuntime } from './runtime'

/** A backgrounded app may suspend before idle. Write the dirty window first. */
export function useTranscriptBackgroundFlush(runtime: { current: ChatRuntime | null }): void {
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'background') runtime.current?.background()
    })
    return () => subscription.remove()
  }, [runtime])
}
