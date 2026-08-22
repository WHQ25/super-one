# context.agent — Agent Interaction API

Node-side. Available on the `context` passed to `activate()` in `manifest.main`.

A MiniApp Host runs whether or not a WebView is mounted, so these work from a
background task with no UI open. From a WebView, ask through
`window.superone.node.postMessage(...)`.

## sendPrompt

Prefills the chat input of the session holding this mini-app. The user still
decides to send — this never sends on its own.

```js
await context.agent.sendPrompt('Analyze this data and create a summary')
```

## setContext

Attaches a context card to the chat input.

```js
await context.agent.setContext({
  summary: '3 files selected',       // shown on the chip
  content: 'src/a.ts\nsrc/b.ts\nsrc/c.ts',  // sent with the next message
  mode: 'inject',                    // 'inject' (default) | 'suggest'
  color: '#4a7fbf',                  // optional chip color
})
```

| Field | Required | Meaning |
|---|---|---|
| `summary` | yes | Short label on the chip |
| `content` | yes | Text delivered to the agent |
| `mode` | no | `inject` attaches automatically; `suggest` needs the user to opt in |
| `color` | no | Chip color |

One card per mini-app: calling `setContext` again replaces it.

## clearContext

```js
await context.agent.clearContext()
```

## onContextConsumed

Fires once the card has gone out with a message. Re-set it if it is still
relevant.

```js
context.subscriptions.push(
  context.agent.onContextConsumed(() => {
    context.webview.postMessage({ type: 'context-consumed' })
  }),
)
```

## From a WebView

```js
// index.html
superone.node.postMessage({ type: 'ask', text: 'Summarize the selection' })

// node.js
context.webview.onMessage(async (message) => {
  if (message?.type === 'ask') await context.agent.sendPrompt(message.text)
})
```
