# Node.js MiniApp Host

Every mini-app has two independent parts:

- A full Electron `<webview>` for HTML/CSS/JS UI.
- A dedicated Node.js MiniApp Host for computation and agent-facing tools.

The MiniApp Host starts from the required `manifest.main` JavaScript entry. It runs in an Electron utility process, is isolated per `(projectDir, appId)`, and outlives its UI tab only when the manifest declares `background`. Mini-app installation explicitly asks the user to trust this entry with full local Node.js access.

## Entry module

```js
export async function activate(context) {
  const tool = context.tools.handle('calculate', async ({ value }) => {
    return { result: Number(value) * 2 }
  })
  context.subscriptions.push(tool)

  const messages = context.webview.onMessage((message) => {
    if (message?.type === 'refresh') {
      context.webview.postMessage({ type: 'data', value: computeData() })
    }
  })
  context.subscriptions.push(messages)
}

export async function deactivate() {
  // Optional final cleanup.
}
```

The entry must export `activate(context)`. `deactivate()` is optional.

## Context

| Member | Purpose |
|---|---|
| `appId` | Current manifest app ID. |
| `appPath` | Installed or development mini-app root. |
| `workspace.rootPath` | Current workspace root. |
| `workspace.storagePath` | Private workspace-scoped data directory, shared by repository worktrees. Created on demand — `mkdir({ recursive: true })` before writing your own files. |
| `globalStoragePath` | Private machine-wide data directory for this mini-app. |
| `workspaceState` | Small JSON-serializable state tied to the workspace. |
| `globalState` | Small JSON-serializable state shared across workspaces. |
| `tools.handle(name, handler)` | Register the implementation of a tool declared in `manifest.tools`. Returns a disposable. |
| `composer.open(spec, { output?, session?, signal? })` | Shared frontend spec/outcome contract: default caller returns values; agent sends a user message and returns status only. Local desktop sessions only. |
| `webview.postMessage(value)` | Send structured-cloneable data to every mounted WebView for this app/project. Queued until the WebView is ready; dropped when no WebView is open, so treat it as notification, not state transfer. |
| `webview.onMessage(handler)` | Receive `window.superone.node.postMessage(...)` from the WebView. Returns a disposable. |
| `subscriptions` | Push disposables here for automatic reverse-order cleanup. |
| `agent.sendPrompt / setContext / clearContext / onContextConsumed` | Reach the chat without a WebView. See `api-agent`. |
| `host.toast / revealInFolder / openExternal / clipboard` | Host actions that need no DOM coordinates. See `api-system`. |
| `layout.snapshot() / act(request)` | Read and arrange the desktop layout of the session holding the app: open a file tab, focus / close tabs, move them beside or into a group (`move_tab`, groups in `snapshot().groups`), resize groups, show or maximize the activity panel (`snapshot().self` is the app's own tab), the bottom terminal, the sidebar, sidebar and panel widths (`snapshot().sizes`), the chat docked / floating / icon (`chat_mode`), a launched session in the split view. Same contract as the agent's `layout_snapshot` / `layout_act`; see Layout below. |
| `locale.get / onChange` | Current SuperOne language. |
| `version` | SuperOne version running this mini-app. |
| `setStatus(text)` | Show a short runtime status in the sidebar. A host with a status set also counts as a background task, so quitting SuperOne asks for confirmation — pass `''` when the work is done. |

## Layout

`context.layout` acts for the session that holds the app — the project's active
session when it holds the app, otherwise the first one that does. It rejects when
no session holds the app.

```ts
const { self, visible } = await context.layout.snapshot()
if (self) await context.layout.act({ action: 'maximize_panel', tab: self })
await context.layout.act({ action: 'open_file', path: 'src/app.ts', line: 42 })
```

- `status: 'applied'` changed the layout on screen; `visible` says whether the
  user sees it.
- `'queued'`: the holder session is not in front, so its own layout takes the
  change when the user opens it.
- `resize_sidebar` / `resize_panel` take a px `width`, clamped to the range in
  `snapshot().sizes`; the result's `width` is what was applied. The chat takes
  the rest, so widen a neighbour to narrow it.
- `chat_mode` with `mode: 'floating' | 'icon'` lets the panel fill the window and
  shows the chat over it as a floating window or an icon; `'docked'` puts it back
  beside the panel. `position` (`'top-left'` … `'left'`, 8 snap anchors) moves the
  floating chat, alone or with a mode.
- `'skipped'`: a window-wide change (sidebar, panel side, widths, chat mode, split view) is refused
  while the holder is not in front, so the user is never moved.
- Browser and terminal tabs are opened by agents with their own tools; the app
  can focus, split, maximize or close any tab. Closing split tiles only removes
  their presentation; it never deletes sessions or stops their tasks.
- `split_session` accepts `sessionIds` as the complete final session list; it
  automatically balances columns/rows within current minimum tile dimensions.
  The current session stays only if listed. Strings use the holder environment;
  `{ environmentId, sessionId }` entries qualify other hosts. The legacy
  `sessionId` + `direction` form still adds a single peer. Do not combine forms.
  With `sessionIds`, optional `layout` specifies nested splits instead of automatic
  placement: a leaf is a 0-based list index (each exactly once), and a branch is
  `{ direction: 'row' | 'column', first, second, ratio? }`. `row` is left/right;
  `column` is top/bottom. Ratio is the first share excluding the divider, default
  `0.5` (range `0.05–0.95`). The complete tree must fit minimum tile dimensions;
  otherwise nothing changes. It preserves focus if listed, or focuses the first
  listed session. Example: `{ sessionIds: ['A', 'B', 'C'], layout: { direction:
  'row', first: 0, second: { direction: 'column', first: 1, second: 2 } } }`.
- `close_split` accepts `sessionIds`, legacy `sessionId`, or `closeAll: true`.
  `closeAll` retains the focused session alone and clears restore state; it
  excludes explicit IDs. Closing every tile also retains the focused session.
  Saved tiles can be closed while maximized.
- `maximize_split` temporarily shows the holder tile alone while preserving
  the mosaic; it requires a current or saved mosaic. `restore_splits` restores
  saved proportions if current space permits. With no saved layout restore is
  a no-op. Mini-apps cannot pass `target` or call `focus_session`.
- `resize_splits` takes `dividers: [{ id, ratio }]` from the snapshot. All changes
  must fit minimum tile dimensions in the final proposed tree, or none apply.
  It preserves structure; use `split_session` with `sessionIds` + `layout` to
  change the split structure or tile order.
- Snapshots and session-layout results include `layout`: current area, capacity,
  tile identities/boxes, focused session, normal/maximized state and divider
  IDs/ratios. Area coordinates use viewport CSS pixels; tile/divider coordinates
  are area-relative. IDs survive focus/resizing while the subtree topology
  remains unchanged; refresh them after topology changes. Hidden saved layouts
  expose identities/proportions without visible geometry.

## Session input forms

A handler receives trusted `(args, ctx)`: `ctx.session` identifies the invoking
session, `ctx.callId` identifies this call, and `ctx.signal` aborts when the call
fails, times out or is cancelled. These facts come from SuperOne, not arguments.

```js
context.tools.handle('review_notes', async (_args, ctx) => {
  return context.composer.open({
    title: 'Review notes',
    requestedSchema: {
      type: 'object', required: ['notes'],
      properties: { notes: { type: 'string', title: 'Notes' } },
    },
  }, { session: ctx.session, signal: ctx.signal })
})
```

Default caller output resolves `{ status: 'submitted', values }`; agent output
sends a user message and resolves `{ status: 'submitted' }` without values.
Cancel resolves `{ status: 'cancelled', reason }`. Fields reuse flat
MCP elicitation JSON Schema, including resource choices and native file picking.
Nested objects and OpenAI previews are rejected. Do not duplicate the form in a
tool result or panel.

Pass `ctx.session` when the app has multiple holders. Without a session, exactly
one authorized local holder is required. Unauthorized or remote targets and a
fifth live app/session form reject. Host and frontend share this quota. Host
disposal and an optional signal close only forms opened by that Host.

Mini-app HTML and widgets share the frontend entry:

```js
const result = await window.superone.composer.open({
  title: 'Review notes',
  requestedSchema: {
    type: 'object', required: ['notes'],
    properties: { notes: { type: 'string', title: 'Notes' } },
  },
})
if (result.status === 'submitted' && 'values' in result) {
  applyNotes(result.values.notes)
}
```

Frontend options accept only `output`; the container binds the target session
and app/message. Both frontends default to caller and wait for the terminal
outcome. Pass `{ output: 'agent' }` to send the answer to the agent instead.
Admission failures reject. Closing/reloading a frontend cancels its caller
forms; agent forms remain in the session. Node-only session/signal options are
unavailable in HTML. Legacy widget `requestInput(spec)` keeps agent output and
opening-only acknowledgement.

The form has no host deadline. An inline awaited tool retains its fixed
120-second limit; use `ctx.signal` to close its form with
the call. For longer human waits, start the form, return from the tool, and handle
its promise separately without that call signal. This does not extend the
60-second Host Action deadline.

## WebView side

```js
const dispose = window.superone.node.onMessage((message) => {
  render(message)
})

window.superone.node.postMessage({ type: 'refresh' })
```

WebView messages sent during activation are queued until `activate()` completes. Tool execution never depends on a WebView being mounted.

## State and storage

Use the state stores for small settings and checkpoints:

```js
const count = (await context.workspaceState.get('count')) ?? 0
await context.workspaceState.update('count', count + 1)
await context.globalState.update('preferredModel', 'fast')
```

`update(key, undefined)` deletes a value. `keys()` lists stored keys.

For larger or queryable data, create files or a database under `workspace.storagePath` or `globalStoragePath` (create the directory first — SuperOne does not pre-create it). The MiniApp Host owns the format and may use SQLite, LevelDB, JSON, or any other Node-compatible library.

## Node access and WebView APIs

The MiniApp Host is a trusted Node.js environment. It may import Node built-ins and installed dependencies, access workspace files through `context.workspace.rootPath`, execute Git, create databases, run subprocesses, and use network clients directly.

WebViews expose no host capabilities of their own. No filesystem, Git, database, key-value, or peer APIs — and no agent, clipboard, toast, reveal, or external-link APIs either: those are `context.agent` / `context.host` on this side. What is left in the WebView is rendering, theme and locale, the anchored surfaces that need DOM coordinates (tooltip, context menu, popover, drag), and `window.superone.node` to reach back here.

Keep privileged computation in `main`; keep rendering and user interaction in WebViews; exchange structured messages across `context.webview` / `window.superone.node`.

## Lifecycle

- The host starts when the app is opened or authorized for a session.
- `activate()` must finish before tool calls or WebView messages are delivered.
- Closing the last panel deactivates a UI-bound host; a later tool call respawns it.
- A host declaring `background: true` in the manifest keeps running with no panel open.
- Stopping/uninstalling the app, closing its final session, or quitting SuperOne deactivates the host.
- An activation failure or process exit rejects pending tool calls and is surfaced as a MiniApp Host error.
