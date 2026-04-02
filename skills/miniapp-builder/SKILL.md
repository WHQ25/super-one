---
name: miniapp-builder
description: "Guide users through creating SuperOne mini-apps — from manifest.json to tool handlers to UI. Use this skill whenever the user wants to create, build, scaffold, or develop a mini-app, canvas app, or plugin for SuperOne. Also trigger when they ask about the mini-app API (superone.fs, superone.tools, superone.agent), manifest format, or how to make their app work with AI agents."
user_invocable: true
arguments: "[app-name]"
---

# Mini-App Builder

Guide the user through creating a SuperOne mini-app from scratch. A mini-app is a sandboxed web application (HTML/CSS/JS) that runs in an iframe on the SuperOne canvas and can be controlled by any AI agent through MCP tools.

## Architecture Overview

Read `docs/canvas-mini-app-architecture.md` for the full architecture. Key points:

- Mini-apps are pure HTML/CSS/JS running in sandboxed iframes
- All agent communication goes through a single built-in MCP proxy (Canvas MCP Proxy)
- The bridge script (`window.superone.*`) is auto-injected into every mini-app's HTML
- Tools declared in `manifest.json` are automatically registered with the MCP proxy when the app opens

## Step 1: Understand What the User Wants

Ask the user:
1. What does the app do? (e.g., "markdown editor", "API tester", "todo list")
2. Does it need to read/write project files? → determines `permissions.fs`
3. Does it need network access? → determines `permissions.network`
4. What tools should the agent be able to call on this app? → determines `tools`
5. Should data live in the project or in a personal directory? → determines `workingDir.scope`

## Step 2: Create the App Directory

Mini-apps live in `examples/miniapp/<app-name>/` during development. In production they are installed to `~/.superone/apps/<app-name>/`.

```
examples/miniapp/<app-name>/
├── manifest.json     # Required: app metadata + permissions + tools
├── index.html        # Required: entry point (bridge script auto-injected)
├── style.css         # Optional
├── app.js            # Optional
└── assets/           # Optional: images, fonts, etc.
```

For framework apps (React, Vue, Svelte), the build output goes here. The user develops in a separate directory and copies `dist/` contents.

## Step 3: Write manifest.json

```json
{
  "name": "Display Name",
  "workingDir": { "scope": "project", "path": "." },
  "permissions": {
    "fs": "project",
    "network": ["api.example.com"]
  },
  "tools": [
    {
      "name": "tool_name",
      "description": "What this tool does — be specific, the agent reads this",
      "inputSchema": {
        "type": "object",
        "properties": {
          "param1": { "type": "string", "description": "Description for the agent" }
        },
        "required": ["param1"]
      }
    }
  ]
}
```

### Manifest Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Display name shown in the app catalog |
| `workingDir` | No | `{ scope, path }`. `scope: "project"` resolves path relative to project root. `scope: "user"` resolves relative to home directory. Default: `{ scope: "project", path: "." }` |
| `permissions.fs` | No | `"app"` (own directory only) or `"project"` (working directory access) |
| `permissions.network` | No | Whitelisted domains for `fetch`. Affects CSP headers. |
| `tools` | No | MCP tools the app handles. Each needs `name`, `description`, and `inputSchema` (JSON Schema format). |

### Tool Design Tips

- Tool names are auto-prefixed with `<appId>:` (e.g., `todo:add_item`). Don't include the prefix in manifest.
- Write clear descriptions — the agent decides when to use the tool based on this text.
- Use JSON Schema's `description` field on each property to help the agent provide correct arguments.
- Keep tools focused: one action per tool rather than a Swiss-army-knife tool with a `mode` parameter.

## Step 4: Write the HTML

The bridge script providing `window.superone` is auto-injected into `<head>` before any other scripts run.

### Available APIs

#### superone.tools — Handle Agent Tool Calls

```js
superone.tools.handle('tool_name', async (args) => {
  // args is the object the agent passed
  // Do something with the DOM, fetch data, etc.
  return { success: true, data: 'result for the agent' }
})
```

The return value is JSON-serialized and sent back to the agent. Return meaningful data — the agent uses it to decide next steps.

#### superone.fs — File System Access

Requires `permissions.fs: "project"`. All paths are relative to the working directory.

```js
const content = await superone.fs.readFile('README.md')
const entries = await superone.fs.readDir('src')       // → [{name, isDir}]
await superone.fs.writeFile('output.md', content)
const exists = await superone.fs.exists('package.json') // → boolean
const files = await superone.fs.glob('**/*.ts')         // → string[]
```

#### superone.agent — Request Agent Actions

```js
superone.agent.sendPrompt('Analyze this data and create a summary')
```

This pre-fills the chat input. The user decides whether to send it. The mini-app cannot silently instruct the agent.

#### superone.theme — Dark Mode

```js
const isDark = superone.isDarkMode()
const unsub = superone.onDarkModeChange((isDark) => {
  document.body.classList.toggle('dark', isDark)
})
```

### Network Access

Mini-apps use standard `fetch()` to access whitelisted domains. No special API needed.

```js
// Requires "api.example.com" in permissions.network
const res = await fetch('https://api.example.com/data')
```

## Step 5: Test the App

1. Run `bun run dev` to start SuperOne in development mode
2. Switch to canvas mode (paintbrush icon in header)
3. The app should appear in the catalog (dev apps from `examples/miniapp/` are auto-discovered)
4. Click to open — verify the UI loads and `miniapp-ready` fires
5. Ask the agent to use the app's tools — verify the full round-trip works

### Debugging Tips

- Open DevTools (Cmd+Option+I) to see iframe console logs
- Check `dev.log` for main process logs (MCP proxy, tool registration)
- If tools aren't showing up, verify `manifest.json` is valid JSON with correct `tools` array
- If `superone` is undefined, check that `index.html` has a `<head>` tag (bridge is injected there)

## Example: Minimal App

See `examples/miniapp/hello/` for a working reference:

- `manifest.json` — declares one tool (`show_message`) and project filesystem access
- `index.html` — registers tool handler, reads directory listing, has button to prompt agent

## Common Patterns

### App That Displays Agent Output

Agent calls a "render" tool → app updates DOM → returns confirmation.

### App That Collects User Input for Agent

User fills a form → clicks button → `superone.agent.sendPrompt()` with form data.

### App That Reads/Writes Project Files

Uses `superone.fs.*` to browse, read, and write files in the working directory.

### App with External API Integration

Declares domains in `permissions.network`, uses `fetch()` to call APIs, displays results.
