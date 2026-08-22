import type { SuperOneMiniAppContext } from '@superone/shared/miniapp-host-api'

/** Host capabilities the WebView asks for through `superone.node`. */
async function runHostAction(
  context: SuperOneMiniAppContext,
  action: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (action) {
    case 'reveal':
      return context.host.revealInFolder(context.workspace.rootPath)
    case 'openLink':
      return context.host.openExternal(String(args.url ?? ''))
    case 'copy':
      return context.host.clipboard.write(String(args.text ?? ''))
    case 'paste':
      return context.host.clipboard.read()
    case 'toast':
      return context.host.toast(String(args.message ?? ''), args.toastType as 'success' | 'error' | 'warning' | 'info')
    case 'sendPrompt':
      return context.agent.sendPrompt(String(args.text ?? ''))
    case 'setContext':
      return context.agent.setContext({
        summary: String(args.summary ?? ''),
        content: String(args.content ?? ''),
        mode: args.mode === 'suggest' ? 'suggest' : 'inject',
        color: args.color as string | undefined,
      })
    case 'clearContext':
      return context.agent.clearContext()
    case 'locale':
      return context.locale.get()
    default:
      throw new Error(`Unknown host action: ${action}`)
  }
}

export async function activate(context: SuperOneMiniAppContext) {
  context.subscriptions.push(
    context.agent.onContextConsumed(() => {
      context.webview.postMessage({ type: 'context-consumed' })
    }),
    context.webview.onMessage(async (raw) => {
      const message = raw as { type?: string; id?: number; action?: string; args?: Record<string, unknown> }
      if (message?.type !== 'host-rpc' || typeof message.id !== 'number') return
      try {
        const result = await runHostAction(context, String(message.action), message.args ?? {})
        context.webview.postMessage({ type: 'host-rpc-result', id: message.id, result })
      } catch (error) {
        context.webview.postMessage({
          type: 'host-rpc-result',
          id: message.id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }),
    context.tools.handle('show_message', (args) => {
      const text = String(args.text ?? '')
      context.webview.postMessage({ type: 'tool-log', text })
      return { success: true, summary: text.slice(0, 40) }
    }),
    context.tools.handle('confirm_action', (args) => {
      const approved = args.approved === true
      const action = String(args.action ?? '')
      const note = String(args.note ?? '')
      const result = {
        action,
        note,
        approved,
        at: new Date().toLocaleTimeString(),
        summary: `${action} · ${approved ? 'approved' : 'cancelled'}`,
      }
      context.webview.postMessage({ type: 'tool-log', text: result.summary })
      return result
    }),
    context.tools.handle('bump_counter', async (args) => {
      const by = typeof args.by === 'number' ? args.by : 1
      const counter = (await context.workspaceState.get<number>('counter')) ?? 0
      const previous = counter
      const value = counter + by
      await context.workspaceState.update('counter', value)
      return { previous, value, by, summary: `${previous} → ${value} (+${by})` }
    }),
  )
}
