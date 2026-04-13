# Mini-App Development Guide

A mini-app is a sandboxed web application (HTML/CSS/JS) that runs in an iframe and can be controlled by any AI agent through MCP tools. Two categories:

- **Standard apps** (`panel`, `sidebar`, `fullscreen`): Persistent interactive apps. The agent interacts via tool calls declared in `tools[]`. Read the `standard` topic for full guide.
- **In-chat apps** (`in-chat`): Data-driven rendering inline in chat messages. The agent passes structured data via `superone.onInit(data)`. Read the `inchat` topic for full guide.

## Architecture

- Mini-apps are pure HTML/CSS/JS running in sandboxed iframes
- All agent communication goes through the built-in SuperOne MCP server
- The bridge script (`window.superone.*`) is auto-injected into every mini-app's HTML `<head>`
- Tools declared in `manifest.json` are automatically registered with the MCP server when the app opens
- Apps are packaged as `.s1app` files (zip + integrity checksums) and installed via drag-and-drop

## Development Workflow

**Before writing any code, confirm the following with the user:**

1. **Clarify requirements** — Ask the user what the app should do. Confirm the core features and scope. Don't assume — ask.
2. **Confirm app type** — Suggest a type (`panel`, `sidebar`, `fullscreen`, or `in-chat`) and explain why. Get user approval.
3. **Suggest template** — Recommend `vanilla` or `react` with reasoning (see "Choosing a Template" below). Get user approval.
4. **Design tools carefully** — Tools are called by the agent, not the user. Only declare tools when the app genuinely needs the agent to push data or trigger actions. Consider whether the app can achieve the functionality on its own using bridge APIs (`superone.git.*`, `superone.fs.*`, etc.) before adding agent-facing tools. Present any proposed tool design to the user and get approval before implementing. See the `tools` topic for details.

Do NOT skip these steps. Do NOT start coding before the user confirms the plan.

**After confirmation, build the app:**

1. Call `setup_mini_app_dev` with the confirmed info (name, type, template, mode, description)
2. The scaffold creates a minimal working app with `manifest.json` and HTML/source files
3. Read the type-specific guide for next steps:
   - `panel`, `sidebar`, `fullscreen` → read **`standard`** topic
   - `in-chat` → read **`inchat`** topic
4. Edit `manifest.json` to add tools, permissions, etc.
5. Write app code

## Choosing a Type

Use **standard app** when:
- The app needs persistent UI (user opens it, interacts over time)
- The agent needs bidirectional tool call communication
- Examples: code editor, file browser, kanban board, API tester

Use **in-chat app** when:
- The app renders structured data inline in chat (no persistent window)
- The agent provides all data upfront, the app just renders it
- Examples: daily report, news cards, image gallery, data table, chart

## Do You Need Tools?

Tools let the **agent** call into your app. Before declaring tools, ask: can the app do this itself?

**You likely DON'T need tools when:**
- The app can fetch its own data using bridge APIs (`superone.git.*`, `superone.fs.*`, etc.)
- The app has its own refresh/reload mechanism (buttons, timers, watchers)
- The interaction is purely user-driven (clicking, scrolling, filtering)

Example: a Git Graph app can call `superone.git.log()` and `superone.git.branches()` directly — it does not need a `refresh` tool for the agent to push git data.

**You likely DO need tools when:**
- The agent needs to push context-specific data that the app cannot obtain on its own (e.g., analysis results, generated content)
- The agent needs to trigger a specific app action as part of a multi-step workflow
- The app is a rendering surface for agent-generated content (in-chat apps always need this)

Example: a Kanban board app needs a `create_task` tool so the agent can add tasks based on conversation context. A code coverage dashboard needs a `render_report` tool so the agent can push test results after running tests.

When in doubt, start without tools. They can always be added later.

## Choosing a Template

Use `vanilla` (default) when:
- Simple to moderate UI: displays, forms, lists, visualizations
- Third-party libraries can be loaded via CDN (declare domain in `permissions.network`)
- Single-file HTML is manageable for the app's complexity

Use `react` when:
- Required libraries are npm-only (no CDN available)
- App complexity makes single-file HTML unmaintainable (many components, complex state)
- User explicitly asks for React or a framework

Most mini-apps should use vanilla. CDN libraries (Chart.js, D3, Alpine.js, Three.js, etc.) work great — add a `<script>` tag and declare the CDN domain in `permissions.network`.

## Choosing a Mode

Use `project` (default) when:
- Building a utility or tool for the current project
- App lives alongside the project's code (stored in `.superone/apps/<appId>/`)

Use `standalone` when:
- The user wants to create a dedicated mini-app project
- The app will be packaged and distributed as `.s1app`
- The entire project directory is the mini-app

## React Template Setup Flow

1. Check for a package manager: `which bun || which npm`
2. If neither found, install bun:
   - macOS/Linux: `curl -fsSL https://bun.sh/install | bash`
   - Windows: `powershell -c "irm bun.sh/install.ps1 | iex"`
3. Call `setup_mini_app_dev` with `template: "react"`
4. Run `<pm> install && <pm> run build` in the app directory
5. For ongoing development with auto-rebuild: `<pm> run build --watch`

Prefer bun over npm when both are available (faster installs and builds).

## App Directory Structure

```
<appId>/
├── manifest.json     # Required: app metadata
├── index.html        # Required: entry point (bridge auto-injected)
├── logo.png          # Optional: app icon (see `icon` topic)
└── ...               # CSS, JS, assets
```

## Updating Type Definitions

If a mini-app was created with an older version of SuperOne and needs access to newly added APIs, call `update_superone_types` with the app directory path. This regenerates `superone.d.ts` with the latest API definitions.

## Testing

1. Run `bun run dev` to start SuperOne in development mode
2. Switch to canvas mode (paintbrush icon in header)
3. The app should appear in the catalog (dev apps from `examples/miniapp/` are auto-discovered)
4. Click to open — verify the UI loads
5. Ask the agent to use the app's tools — verify the round-trip works

## Debugging Tips

- Open DevTools (Cmd+Option+I) to see iframe console logs
- Check `dev.log` for main process logs (`[superone-mcp]` prefix for tool registration)
- If tools aren't showing up, verify `manifest.json` has valid `toolSlug` and `tools` array
- If `superone` is undefined, check that `index.html` has a `<head>` tag (bridge is injected there)

## Example

See `examples/miniapp/hello/` for a working standard app reference.
