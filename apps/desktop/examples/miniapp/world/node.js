import { readdir } from 'node:fs/promises'

export function activate(context) {
  context.subscriptions.push(
    context.tools.handle('show_message', ({ text }) => {
      context.webview.postMessage({ type: 'display-message', text })
      return { success: true, displayed: text }
    }),
    context.webview.onMessage(async (message) => {
      if (message?.type === 'list-files') {
        context.webview.postMessage({ type: 'workspace-files', files: await readdir(context.workspace.rootPath) })
      } else if (message?.type === 'send-prompt') {
        await context.agent.sendPrompt(message.text)
      }
    }),
  )
}
