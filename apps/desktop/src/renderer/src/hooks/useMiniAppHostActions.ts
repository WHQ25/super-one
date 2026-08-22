import { useEffect } from 'react'
import { runMiniAppHostAction } from '@/lib/miniapp-host-actions'

/**
 * Global listener for MiniApp Host actions.
 *
 * Mounted once at the app root, NOT per mini-app panel: a MiniApp Host runs
 * without any WebView, and its whole point is being able to reach the user
 * anyway (toast when a background sync finishes, prompt the agent, …).
 */
export function useMiniAppHostActions(): void {
  useEffect(() => {
    return window.miniapp.onHostAction(async ({ requestId, appId, projectDir, action, args }) => {
      try {
        const result = await runMiniAppHostAction(appId, projectDir, action, args ?? {})
        window.miniapp.hostActionResult(requestId, result)
      } catch (error) {
        window.miniapp.hostActionResult(requestId, undefined, error instanceof Error ? error.message : String(error))
      }
    })
  }, [])
}
