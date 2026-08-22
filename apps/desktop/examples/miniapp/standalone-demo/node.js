export function activate(context) {
  let counter = 0

  const publish = (delta = 0, reset = false) => {
    context.webview.postMessage({ type: 'count-changed', value: counter, delta, reset })
  }
  const increment = ({ by }) => {
    const amount = typeof by === 'number' && Number.isFinite(by) ? by : 1
    const previous = counter
    counter += amount
    publish(amount)
    return { ok: true, previous, value: counter }
  }

  context.subscriptions.push(
    context.tools.handle('increment', increment),
    context.tools.handle('confirm_increment', increment),
    context.tools.handle('read_counter', () => ({ value: counter })),
    context.tools.handle('reset', () => {
      counter = 0
      publish(0, true)
      return { ok: true, value: counter }
    }),
    context.tools.handle('show_counter', () => {
      publish()
      return { value: counter, source: 'miniapp-host' }
    }),
    context.webview.onMessage((message) => {
      if (message?.type === 'increment') increment({ by: 1 })
      if (message?.type === 'get-state') publish()
    }),
  )
}
