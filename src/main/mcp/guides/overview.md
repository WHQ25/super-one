# Mini-App Development Guide

A mini-app is a sandboxed web application (HTML/CSS/JS) that runs in an iframe on the SuperOne canvas and can be controlled by any AI agent through MCP tools.

## Architecture

- Mini-apps are pure HTML/CSS/JS running in sandboxed iframes
- All agent communication goes through the built-in SuperOne MCP server
- The bridge script (`window.superone.*`) is auto-injected into every mini-app's HTML `<head>`
- Tools declared in `manifest.json` are automatically registered with the MCP server when the app opens
- Apps are packaged as `.s1app` files (zip + integrity checksums) and installed via drag-and-drop
- Manifest is validated with Zod schema; invalid manifests are rejected

## Requirements Checklist

Before building, clarify:
1. What does the app do? (e.g., "markdown editor", "API tester", "todo list")
2. Does it need to read/write project files? → determines `permissions.fs`
3. Does it need network access? → determines `permissions.network`
4. What tools should the agent be able to call on this app? → determines `tools`
5. Should data live in the project or in a personal directory? → determines `workingDir.scope`

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

## Example

See `examples/miniapp/hello/` for a working reference:
- `manifest.json` — declares one tool (`show_message`) and project filesystem access
- `index.html` — registers tool handler, reads directory listing, has button to prompt agent
