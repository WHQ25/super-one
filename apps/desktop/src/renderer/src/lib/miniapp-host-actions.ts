import { toast } from 'sonner'
import { useChatStore, type SessionWriteTarget } from '@/stores/chat'
import { useMiniAppStore } from '@/stores/miniapp'
import { requestOpenExternalLink } from '@/lib/external-link'
import { requestClipboardRead, requestClipboardWrite } from '@/lib/miniapp-clipboard'

/**
 * Executes the host actions a MiniApp Host asks for.
 *
 * These live in the renderer even though the API is Node-side: the toast
 * surface, the chat store, and the clipboard / external-link consent prompts
 * are all here. Main only addresses the request; nothing bypasses a prompt.
 */

// A mini-app belongs to its holder session(s), not the project's active one —
// route its chat writes there so a backgrounded app doesn't inject into the
// session a user happens to be viewing in another mosaic pane.
export function miniAppSessionTarget(appId: string, projectDir: string): SessionWriteTarget | undefined {
  if (!projectDir) return undefined
  const open = Object.values(useMiniAppStore.getState().openApps)
    .find((a) => a.entry.id === appId && a.projectDir === projectDir)
  if (!open || open.holderSessions.size === 0) return undefined
  const active = useChatStore.getState().projectSessions[projectDir]?._activeSessionId
  if (active && open.holderSessions.has(active)) return { projectPath: projectDir, sessionId: active }
  const first = open.holderSessions.values().next().value as string | undefined
  return first ? { projectPath: projectDir, sessionId: first } : undefined
}

const TOASTS: Record<string, (message: string) => void> = {
  success: toast.success, error: toast.error, warning: toast.warning, info: toast.info,
}

export async function runMiniAppHostAction(
  appId: string,
  projectDir: string,
  action: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (action) {
    case 'agent.sendPrompt': {
      const text = args.text
      if (typeof text !== 'string') throw new Error('sendPrompt: text must be a string')
      useChatStore.getState().setDraftText(text, miniAppSessionTarget(appId, projectDir))
      return undefined
    }
    case 'agent.setContext': {
      const app = useMiniAppStore.getState().apps.find((a) => a.id === appId)
      useChatStore.getState().setMiniAppContext(appId, {
        appName: app?.manifest.name ?? appId,
        summary: String(args.summary ?? ''),
        content: String(args.content ?? ''),
        mode: args.mode === 'suggest' ? 'suggest' : 'inject',
        color: typeof args.color === 'string' ? args.color : undefined,
      }, miniAppSessionTarget(appId, projectDir))
      return undefined
    }
    case 'agent.clearContext':
      useChatStore.getState().clearMiniAppContext(appId, miniAppSessionTarget(appId, projectDir))
      return undefined
    case 'host.toast': {
      const message = String(args.message ?? '')
      if (!message) return undefined
      ;(TOASTS[String(args.toastType)] ?? toast.info)(message)
      return undefined
    }
    case 'host.revealInFolder': {
      const path = args.path
      if (typeof path !== 'string') throw new Error('revealInFolder: path must be a string')
      window.miniapp.showItemInFolder(projectDir, appId, path)
      return undefined
    }
    case 'host.openExternal': {
      const url = args.url
      if (typeof url !== 'string') throw new Error('openExternal: url must be a string')
      requestOpenExternalLink(url)
      return undefined
    }
    case 'host.clipboard.read':
      return requestClipboardRead(appId)
    case 'host.clipboard.write': {
      const text = args.text
      if (typeof text !== 'string') throw new Error('clipboard.write: text must be a string')
      requestClipboardWrite(appId, text)
      return undefined
    }
    default:
      throw new Error(`Unknown host action: ${action}`)
  }
}
