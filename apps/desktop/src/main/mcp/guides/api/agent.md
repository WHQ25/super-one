# superone.agent — Agent Interaction API

APIs for the mini-app to interact with the AI agent.

## sendPrompt

Pre-fill the chat input with a prompt. The user decides whether to send it — the mini-app cannot silently instruct the agent.

```js
superone.agent.sendPrompt('Analyze this data and create a summary')
```

### Use Cases

- User clicks a button in the app → app suggests a prompt for the agent
- App detects an issue → suggests the agent investigate
- Form submission → converts form data to a natural language request

```js
// Example: form-driven prompt
const form = document.getElementById('search-form')
form.addEventListener('submit', (e) => {
  e.preventDefault()
  const query = new FormData(form).get('query')
  superone.agent.sendPrompt(`Search the codebase for: ${query}`)
})
```

## setContext

Inject contextual information from the mini-app into chat messages. The context appears as a visible chip in the chat input area, giving the user full control.

```js
superone.agent.setContext({
  summary: '3 selected tasks',        // Short label shown on the chip
  content: 'Task 1: Fix login bug\nTask 2: Add dark mode\nTask 3: Update footer',  // Full text injected into the message
  mode: 'inject',                      // 'inject' (auto-included, X to remove) or 'suggest' (opt-in checkbox)
  color: '#4a7fbf',                    // Optional base color for the chip (hex)
})
```

Each app has one context slot. Calling `setContext` again overwrites the previous context.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `summary` | `string` | Yes | Short text shown on the context chip |
| `content` | `string` | Yes | Full context text injected into the agent message |
| `mode` | `'inject' \| 'suggest'` | No | Default: `'inject'`. In inject mode the context is auto-included and the user can remove it. In suggest mode the user must opt-in by clicking a checkbox. |
| `color` | `string` | No | Base hex color (e.g. `'#4a7fbf'`). Background, text, and label colors are derived automatically. |

### Modes

- **inject**: Context is automatically included in the next message. The chip shows an X button — the user can dismiss it if they don't want it.
- **suggest**: Context is not included by default. The chip shows a checkbox — the user clicks it to opt-in. Suggest-mode contexts are cleared after being sent once.

```js
// Inject mode: always included unless user dismisses
superone.agent.setContext({
  summary: 'Current selection',
  content: JSON.stringify(selectedItems, null, 2),
  mode: 'inject',
  color: '#c4873a',
})

// Suggest mode: user opts in
superone.agent.setContext({
  summary: 'Meeting notes',
  content: meetingTranscript,
  mode: 'suggest',
  color: '#4a9a6a',
})
```

## clearContext

Remove the app's context chip from the chat input.

```js
superone.agent.clearContext()
```

## onContextConsumed

Called when the user sends a message that includes this app's context. The context chip is automatically cleared after sending. Use this callback to decide whether to re-inject context.

```js
superone.agent.onContextConsumed(() => {
  // Context was consumed — re-inject if state hasn't changed
  if (hasRelevantState()) {
    superone.agent.setContext({
      summary: 'Current selection',
      content: getSelectionAsText(),
      mode: 'inject',
    })
  }
})
```

Returns an unsubscribe function:

```js
const unsub = superone.agent.onContextConsumed(() => { ... })
unsub() // stop listening
```
