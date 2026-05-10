# Mini-App Development Guide

A mini-app is a sandboxed web application (HTML/CSS/JS) that runs in an iframe and can be controlled by any AI agent through MCP tools.

Every app is a single kind: it always opens as a tab in the activity panel. Set `fullscreen: true` in the manifest if it should also be openable in the canvas full-screen view. Apps can declare `tools[]` so the agent can drive them, and any tool can attach a custom result renderer (`tools[].renderer.result`) to render its output inline in the chat — read the `tools` topic for both. Read the `standard` topic for the basic structure of an interactive app.

## Architecture

- Mini-apps are pure HTML/CSS/JS running in sandboxed iframes
- All agent communication goes through the built-in SuperOne MCP server
- The bridge script (`window.superone.*`) is auto-injected into every mini-app's HTML `<head>`
- Tools declared in `manifest.json` are automatically registered with the MCP server when the app opens
- Apps are packaged as `.s1app` files (zip + integrity checksums) and installed via drag-and-drop

## Development Workflow

**Before writing any code, confirm the following with the user:**

1. **Clarify requirements** — Ask the user what the app should do. Confirm the core features and scope. Don't assume — ask.
2. **Confirm fullscreen** — Should the app also be openable in the canvas full-screen view (`fullscreen: true`), or panel-only (default)? Get user approval.
3. **Suggest template** — Recommend `vanilla` or `react` with reasoning (see "Choosing a Template" below). Get user approval.
4. **Design tools carefully** — Tools are called by the agent, not the user. Only declare tools when the app genuinely needs the agent to push data or trigger actions. Consider whether the app can achieve the functionality on its own using bridge APIs (`superone.git.*`, `superone.fs.*`, etc.) before adding agent-facing tools. If a tool's output should render inline in chat with a custom UI, declare `renderer.result.template` for that tool. Present any proposed tool design to the user and get approval before implementing. See the `tools` topic for details.

Do NOT skip these steps. Do NOT start coding before the user confirms the plan.

**After confirmation, build the app:**

1. Confirm with the user **where** the mini-app source should live (`directory`) and **who** should see it (`scope`: `project` or `user`). See "Where the App Lives" below.
2. Call `setup_mini_app_dev` with the confirmed info (name, slug, directory, scope, projectDir if scope=project, template, fullscreen, description). It scaffolds files at `directory` and writes a `.s1-dev.json` pointer so SuperOne can discover the app.
3. Read **`standard`** for the basic app structure, then **`tools`** for declaring agent-facing tools and custom inline renderers.
4. Edit `manifest.json` to add tools, permissions, etc.
5. Write app code

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
- The app is a rendering surface for agent-generated content (declare `renderer.result.template` on the tool to render inline in chat)

Example: a Kanban board app needs a `create_task` tool so the agent can add tasks based on conversation context. A code coverage dashboard needs a `render_report` tool with `renderer.result.template` so the agent can push test results and the chat shows the styled report inline.

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

## Where the App Lives — `directory` and `scope`

`setup_mini_app_dev` takes two location-related arguments:

- **`directory`** (required, absolute path): where the mini-app source files are scaffolded. This is the **user's choice** — anywhere on disk. Common patterns:
  - Inside a project's source tree: `<projectDir>/packages/my-app` (monorepo workspace), `<projectDir>/tools/dashboard`
  - A dedicated standalone dir: `~/code/my-mini-app`
- **`scope`**: who can see this app
  - `project` (default): only visible when SuperOne is opened on `projectDir`. Required argument: `projectDir`. The `directory` MUST be inside `projectDir`.
  - `user`: visible across every project on this machine. `projectDir` not required; `directory` can be anywhere.

After scaffolding, `setup_mini_app_dev` writes a small pointer file at:

- `<projectDir>/.superone/apps/<appId>/.s1-dev.json` for `scope=project`
- `~/.superone/apps/<appId>/.s1-dev.json` for `scope=user`

This pointer is how SuperOne discovers the app:

```jsonc
{
  "distDir": "packages/my-app/dist",   // relative to projectDir for scope=project; absolute for scope=user
  "enabled": true                       // set false to fall back to a packed prod version (see "Switching dev/prod" below)
}
```

**No registry file, no symlink** — each app's pointer lives in its own slot under `.superone/apps/<appId>/`. The slot also holds `data/` (the app's persistent storage when `permissions.fs` declares `scope: 'app'`), which survives any rebuild or pack/install cycle.

### Choosing scope

Use `project` (default) when:
- Building a tool specific to the current codebase (kanban, dashboard, custom helper)
- The whole team should auto-discover this dev app by committing `.superone/apps/<appId>/.s1-dev.json` into git (relative `distDir` makes this portable)

Use `user` when:
- Building a personal tool you want available regardless of which project you open (e.g. a notes pad, a clipboard manager)
- Cross-machine distribution will go through `pack_mini_app` → `.s1app` → drag-drop install, not via this dev pointer

## React Template Setup Flow

1. Check for a package manager: `which bun || which npm`
2. If neither found, install bun:
   - macOS/Linux: `curl -fsSL https://bun.sh/install | bash`
   - Windows: `powershell -c "irm bun.sh/install.ps1 | iex"`
3. Decide where the mini-app project lives (any directory; for `scope=project`, must be inside `projectDir` — e.g. `packages/<name>` for a monorepo workspace)
4. Call `setup_mini_app_dev` with `template: "react"`, `directory` pointing to that path, and the chosen `scope`
5. Run `<pm> install && <pm> run build` in the directory
6. For ongoing development with auto-rebuild: `<pm> run build --watch`

Prefer bun over npm when both are available (faster installs and builds).

## Switching between Dev and Prod Versions

Once a `.s1app` package has been installed by drag-drop into the same install slot, both versions can coexist:

- `.s1-dev.json` with `enabled: true` → SuperOne loads files from your dev `distDir` (live build output)
- `.s1-dev.json` with `enabled: false` → SuperOne loads the packed prod files from the install slot itself
- Delete `.s1-dev.json` → only the prod version remains

**Drag-drop install never deletes `.s1-dev.json` or the `data/` directory** — your dev pointer and user data are preserved across version upgrades.

## App Directory Structure

The directory you scaffold into (the user-chosen `directory`) holds the actual mini-app source:

```
<directory>/                  # for vanilla — manifest.json + index.html in root
├── manifest.json             # Required: app metadata
├── index.html                # Required: entry point (bridge auto-injected)
├── logo.png                  # Optional: app icon (see `icon` topic)
└── ...                       # CSS, JS, assets

<directory>/                  # for react — Vite project
├── package.json
├── vite.config.ts
├── src/
└── dist/                     # build output that SuperOne actually serves
    ├── manifest.json
    ├── index.html
    └── ...
```

The install slot at `<scope-root>/.superone/apps/<appId>/` holds only:

```
<appId>/
├── .s1-dev.json     # dev pointer (this file is what makes the app discoverable)
└── data/            # created lazily on first app-scope fs write
```

After `pack_mini_app` + drag-drop install, the slot also contains the packed prod files (manifest.json, index.html, …) alongside `.s1-dev.json` and `data/`.

## Updating Type Definitions

If a mini-app was created with an older version of SuperOne and needs access to newly added APIs, call `update_superone_types` with the app directory path. This regenerates `superone.d.ts` with the latest API definitions.


