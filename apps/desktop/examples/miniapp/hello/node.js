import { readdir } from 'node:fs/promises'

export function activate(context) {
  let consumedCount = 0

  context.subscriptions.push(
    context.tools.handle('show_message', ({ text }) => {
      context.webview.postMessage({ type: 'display-message', text })
      return { success: true, displayed: text }
    }),
    context.tools.handle('confirm_purchase', (args) => {
      const orderId = `ord_${Math.random().toString(36).slice(2, 8)}`
      context.webview.postMessage({
        type: 'display-message',
        text: `Purchase placed: item=${args.item_id} qty=${args.final_qty} payment=${args.payment}`,
      })
      return {
        order_id: orderId,
        item_id: args.item_id,
        qty: args.final_qty,
        payment: args.payment,
        summary: `${orderId} · ${args.final_qty} × ${args.item_id} (${args.payment})`,
      }
    }),

    // The agent context card is a Node-side API, so the event is too.
    context.agent.onContextConsumed(() => {
      consumedCount += 1
      context.webview.postMessage({ type: 'context-consumed', count: consumedCount })
    }),

    // Every host capability lives here; the WebView only asks for it.
    context.webview.onMessage(async (message) => {
      switch (message?.type) {
        case 'list-files':
          context.webview.postMessage({ type: 'workspace-files', files: await readdir(context.workspace.rootPath) })
          return
        case 'open-folder':
          await context.host.revealInFolder(context.workspace.rootPath)
          return
        case 'open-link':
          await context.host.openExternal(message.url)
          return
        case 'copy':
          await context.host.clipboard.write(message.text)
          return
        case 'paste':
          try {
            context.webview.postMessage({ type: 'clipboard', text: await context.host.clipboard.read() })
          } catch (error) {
            context.webview.postMessage({ type: 'clipboard', error: error.message })
          }
          return
        case 'toast':
          await context.host.toast(message.text, message.toastType)
          return
        case 'send-prompt':
          await context.agent.sendPrompt(message.text)
          return
        case 'set-context':
          await context.agent.setContext({
            summary: message.summary,
            content: message.content,
            mode: message.mode,
            color: message.color,
          })
          return
        case 'clear-context':
          await context.agent.clearContext()
          return
      }
    }),
  )
}
