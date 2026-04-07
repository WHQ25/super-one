# Mini-App APIs

The bridge script providing `window.superone` is auto-injected into `<head>` before any other scripts run.

## superone.onInit — Receive Data (In-Chat Apps)

For in-chat apps, this is the primary entry point. The agent passes structured data via the MCP tool, and the app receives it here.

```js
superone.onInit((data) => {
  // data is the object the agent passed to the inchat__<inChatToolName> MCP tool
  document.getElementById('root').innerHTML = renderContent(data)
})
```

The callback fires once after the iframe is ready and data is injected. If the callback is registered after data has already arrived, it fires immediately (late-subscriber safe).

Canvas apps can also use `onInit`, but it will never fire since canvas apps don't receive initialization data this way.

## superone.tools — Handle Agent Tool Calls (Canvas Apps)

```js
superone.tools.handle('tool_name', async (args) => {
  // args is the object the agent passed
  // Do something with the DOM, fetch data, etc.
  return { success: true, data: 'result for the agent' }
})
```

The return value is JSON-serialized and sent back to the agent. Return meaningful data — the agent uses it to decide next steps.

## superone.fs — File System Access

Requires at least one entry in `permissions.fs`. All paths are relative to the declared directories.

```js
const content = await superone.fs.readFile('README.md')
const entries = await superone.fs.readDir('src')       // → [{name, isDir}]
await superone.fs.writeFile('output.md', content)
const exists = await superone.fs.exists('package.json') // → boolean
const files = await superone.fs.glob('**/*.ts')         // → string[]
```

### File Watching

Watch a file or directory for changes. The callback receives `{ type, path }` where `type` is `'change'` or `'rename'`.

```js
const watchId = await superone.fs.watch('src', (event) => {
  console.log(event.type, event.path)  // e.g. 'change', 'src/main.ts'
})

// Stop watching
superone.fs.unwatch(watchId)
```

Watching is recursive by default. All watchers are automatically cleaned up when the mini-app is closed.

## superone.agent — Request Agent Actions

```js
superone.agent.sendPrompt('Analyze this data and create a summary')
```

This pre-fills the chat input. The user decides whether to send it. The mini-app cannot silently instruct the agent.

## superone.git — Git Integration

Read-only access to the project's Git repository. All operations are scoped to the mini-app's working directory.

```js
const info = await superone.git.info()
// → { branch: 'main', dirty?: { files: 3, insertions: 42, deletions: 7 } }

const branches = await superone.git.branches()
// → ['main', 'feature/auth', 'fix/typo']

const log = await superone.git.log({ limit: 20 })
// → [{ sha, parents: ['abc123'], message, author, date }, ...]

const files = await superone.git.status()
// → [{ path: 'src/main.ts', status: 'M', staged: false }, ...]

const diff = await superone.git.diff('src/main.ts')
// → { path: 'src/main.ts', diff: '--- a/src/main.ts\n+++ b/...' }

const file = await superone.git.show('HEAD~1', 'package.json')
// → { ref: 'HEAD~1', path: 'package.json', content: '...' }
```

### Watching for Changes

Subscribe to HEAD changes (branch switch, commit, rebase, etc.):

```js
const unsub = superone.git.onHeadChange(() => {
  // Re-fetch git data
})
```

### Status Codes

`M` Modified, `A` Added, `D` Deleted, `R` Renamed, `C` Copied, `U` Unmerged, `?` Untracked, `!` Ignored.

### Write Operations

Git write operations (commit, push, merge, etc.) are not exposed directly. Use `superone.agent.sendPrompt()` to request the AI agent to perform them on your behalf.

## Theme

The host app injects its design tokens as CSS custom properties on the mini-app's `:root`. These variables update automatically when the user switches between light and dark mode. You are free to use them or ignore them — they are provided so you can match the host theme if you choose to.

### CSS Variables

Use standard `var()` references in your CSS:

```css
body {
  background-color: var(--background);
  color: var(--foreground);
}
button {
  background-color: var(--primary);
  color: var(--primary-foreground);
  border-radius: var(--radius);
}
.card {
  background: var(--card);
  color: var(--card-foreground);
  border: 1px solid var(--border);
}
.sidebar {
  background: var(--sidebar);
  color: var(--sidebar-foreground);
}
```

**Core variables:** `--background`, `--foreground`, `--card`, `--card-foreground`, `--popover`, `--popover-foreground`, `--primary`, `--primary-foreground`, `--secondary`, `--secondary-foreground`, `--muted`, `--muted-foreground`, `--accent`, `--accent-foreground`, `--destructive`, `--destructive-foreground`, `--border`, `--ring`, `--radius`.

**Sidebar variables:** `--sidebar`, `--sidebar-foreground`, `--sidebar-primary`, `--sidebar-primary-foreground`, `--sidebar-accent`, `--sidebar-accent-foreground`, `--sidebar-border`, `--sidebar-ring`.

### superone.theme — Programmatic Access

```js
const vars = superone.theme.getVars()
// → { background: 'oklch(...)', primary: 'oklch(...)', radius: '0.625rem', ... }

const unsub = superone.theme.onChange((vars) => {
  // Called when theme changes (e.g., light ↔ dark toggle)
})
```

### Dark Mode

The host syncs the `dark` class on `<html>` and provides helpers:

```js
const isDark = superone.isDarkMode()
const unsub = superone.onDarkModeChange((isDark) => {
  // isDark: boolean
})
```

## Network Access

Mini-apps use standard `fetch()` to access whitelisted domains. No special API needed.

```js
// Requires "api.example.com" in permissions.network
const res = await fetch('https://api.example.com/data')
```

## Display Types & Frame Constraints

Mini-apps render inside an iframe that fills its container. The available space depends on the `type` declared in `manifest.json`:

| Type | Container | Typical Width | Notes |
|------|-----------|---------------|-------|
| `sidebar` | Left sidebar panel | ~240–280px | Very narrow — use vertical layouts, avoid wide tables |
| `panel` | Activity panel (right side) | 320–800px, user-resizable | Default type. Design for ~400px minimum width |
| `in-chat` | Inline in chat messages | Chat panel width | Auto-height via ResizeObserver. Use `superone.onInit()` for data. |
| `fullscreen` | Full canvas area | Window width minus sidebar | Most space available |

### Layout Guidelines

- The iframe has its own scrolling — content that exceeds the container will scroll automatically
- **Avoid fixed widths** — use `width: 100%`, `max-width`, or CSS Grid/Flexbox for responsive layouts
- **Wide content** (tables, charts) should use `overflow-x: auto` on the container so they scroll horizontally within the iframe
- **Sidebar apps** are very narrow — prefer stacked/vertical layouts over side-by-side columns
- Use `var(--background)`, `var(--foreground)` etc. to match the host theme (see Theme section above)

```css
/* Responsive table example */
.table-container {
  width: 100%;
  overflow-x: auto;
}
table {
  min-width: 600px; /* scrolls horizontally in narrow containers */
}
```

## Common Patterns

### In-Chat Data Renderer

Agent collects data → calls `inchat__render_xxx(data)` → app renders inline in chat. No tool call round-trip needed.

```js
superone.onInit((data) => {
  // data = { title: "Daily Report", sections: [...] }
  document.getElementById('root').innerHTML = buildReport(data)
})
```

### App That Displays Agent Output (Canvas)

Agent calls a "render" tool → app updates DOM → returns confirmation.

### App That Collects User Input for Agent

User fills a form → clicks button → `superone.agent.sendPrompt()` with form data.

### App That Reads/Writes Project Files

Uses `superone.fs.*` to browse, read, and write files in the working directory.

### App with External API Integration

Declares domains in `permissions.network`, uses `fetch()` to call APIs, displays results.
