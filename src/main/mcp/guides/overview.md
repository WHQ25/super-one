# Mini-App Development Guide

A mini-app is a sandboxed web application (HTML/CSS/JS) that runs in an iframe and can be controlled by any AI agent through MCP tools. Mini-apps come in two flavors:

- **Canvas apps** (`panel`, `sidebar`, `fullscreen`): Persistent interactive apps opened by the user on the canvas. The agent interacts via tool calls declared in `tools[]`.
- **In-chat apps** (`in-chat`): Data-driven rendering templates displayed inline in chat messages. The agent passes structured data, and the app renders it. No tool call interaction needed — the app receives data via `superone.onInit(data)`.

## Architecture

- Mini-apps are pure HTML/CSS/JS running in sandboxed iframes
- All agent communication goes through the built-in SuperOne MCP server
- The bridge script (`window.superone.*`) is auto-injected into every mini-app's HTML `<head>`
- Tools declared in `manifest.json` are automatically registered with the MCP server when the app opens
- Apps are packaged as `.s1app` files (zip + integrity checksums) and installed via drag-and-drop
- Manifest is validated with Zod schema; invalid manifests are rejected

## Choosing Canvas vs In-Chat

Use **canvas app** when:
- The app needs persistent UI (user opens it, interacts over time)
- The agent needs bidirectional tool call communication with the app
- Examples: code editor, file browser, kanban board, API tester

Use **in-chat app** when:
- The app renders structured data inline in chat (no persistent window)
- The agent provides all data upfront, the app just renders it
- Examples: daily report, news cards, image gallery, data table, chart

## Requirements Checklist (Canvas Apps)

Before building, clarify:
1. What does the app do? (e.g., "markdown editor", "API tester", "todo list")
2. Does it need to read/write project files? → add `{ scope: "project", path: "." }` to `permissions.fs`
3. Does it need user-level storage? → add `{ scope: "user", path: ".config/<app>" }` to `permissions.fs`
4. Does it need network access? → determines `permissions.network`
5. What tools should the agent be able to call on this app? → determines `tools`

## Requirements Checklist (In-Chat Apps)

Before building, clarify:
1. What data does the agent pass to the app? → determines `inputSchema`
2. What should the MCP tool be called? → determines `inChatToolName` (registered as `inchat__<inChatToolName>`)
3. Does the app need network access (e.g., load images from CDN)? → determines `permissions.network`

## App Directory Structure

Mini-apps live in `examples/miniapp/<app-name>/` during development. In production they are installed to `~/.superone/apps/<app-name>/`.

```
examples/miniapp/<app-name>/
├── manifest.json     # Required: app metadata + permissions + tools
├── index.html        # Required: entry point (bridge script auto-injected)
├── icon.svg          # Optional: 24×24 monochrome icon (read `icon` topic for spec)
├── logo.png          # Optional: 256×256 full-color brand image
├── style.css         # Optional
├── app.js            # Optional
└── assets/           # Optional: images, fonts, etc.
```

For framework apps (React, Vue, Svelte), the build output goes here. The user develops in a separate directory and copies `dist/` contents.

## Testing

1. Run `bun run dev` to start SuperOne in development mode
2. Switch to canvas mode (paintbrush icon in header)
3. The app should appear in the catalog (dev apps from `examples/miniapp/` are auto-discovered)
4. Click to open — verify the UI loads and `miniapp-ready` fires
5. Ask the agent to use the app's tools — verify the full round-trip works

## Debugging Tips

- Open DevTools (Cmd+Option+I) to see iframe console logs
- Check `dev.log` for main process logs (`[superone-mcp]` prefix for tool registration)
- If tools aren't showing up, verify `manifest.json` is valid JSON with correct `tools` array
- If `superone` is undefined, check that `index.html` has a `<head>` tag (bridge is injected there)

## Choosing a Template

Use `vanilla` (default) when:
- Simple to moderate UI: displays, forms, lists, visualizations
- Third-party libraries can be loaded via CDN (declare domain in `permissions.network`)
- Single-file HTML is manageable for the app's complexity

Use `react` when:
- Required libraries are npm-only (no CDN available)
- App complexity makes single-file HTML unmaintainable (many components, complex state)
- User explicitly asks for React or a framework

Most mini-apps should use vanilla. CDN libraries (Chart.js, D3, Alpine.js, Three.js, etc.) work great in vanilla apps — add a `<script>` tag and declare the CDN domain in `permissions.network`.

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

## Example

See `examples/miniapp/hello/` for a working reference:
- `manifest.json` — declares one tool (`show_message`) and project filesystem access
- `index.html` — registers tool handler, reads directory listing, has button to prompt agent
