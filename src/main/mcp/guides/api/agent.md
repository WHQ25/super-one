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
