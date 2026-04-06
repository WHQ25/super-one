# Mini-App APIs

The bridge script providing `window.superone` is auto-injected into `<head>` before any other scripts run.

## superone.tools — Handle Agent Tool Calls

```js
superone.tools.handle('tool_name', async (args) => {
  // args is the object the agent passed
  // Do something with the DOM, fetch data, etc.
  return { success: true, data: 'result for the agent' }
})
```

The return value is JSON-serialized and sent back to the agent. Return meaningful data — the agent uses it to decide next steps.

## superone.fs — File System Access

Requires `permissions.fs: "project"`. All paths are relative to the working directory.

```js
const content = await superone.fs.readFile('README.md')
const entries = await superone.fs.readDir('src')       // → [{name, isDir}]
await superone.fs.writeFile('output.md', content)
const exists = await superone.fs.exists('package.json') // → boolean
const files = await superone.fs.glob('**/*.ts')         // → string[]
```

## superone.agent — Request Agent Actions

```js
superone.agent.sendPrompt('Analyze this data and create a summary')
```

This pre-fills the chat input. The user decides whether to send it. The mini-app cannot silently instruct the agent.

## superone.theme — Dark Mode

```js
const isDark = superone.isDarkMode()
const unsub = superone.onDarkModeChange((isDark) => {
  document.body.classList.toggle('dark', isDark)
})
```

## Network Access

Mini-apps use standard `fetch()` to access whitelisted domains. No special API needed.

```js
// Requires "api.example.com" in permissions.network
const res = await fetch('https://api.example.com/data')
```

## Common Patterns

### App That Displays Agent Output

Agent calls a "render" tool → app updates DOM → returns confirmation.

### App That Collects User Input for Agent

User fills a form → clicks button → `superone.agent.sendPrompt()` with form data.

### App That Reads/Writes Project Files

Uses `superone.fs.*` to browse, read, and write files in the working directory.

### App with External API Integration

Declares domains in `permissions.network`, uses `fetch()` to call APIs, displays results.
