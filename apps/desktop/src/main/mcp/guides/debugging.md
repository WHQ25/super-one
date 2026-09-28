# Debugging Mini-Apps

Development mini-apps (from `miniapp_dev_setup` or `miniapp_dev_register`) are inspected and driven with the regular `browser_*` tools. Installed apps are not exposed.

## View ids

Pass one of these as `tab`:

| Id | View |
|---|---|
| `miniapp:<appId>` | The app panel. Opened when it is closed. |
| `miniapp:<appId>:preview` | The tool UI rendered by `miniapp_dev_preview`. |
| `miniapp:<appId>:tool:<toolUseId>` | A tool UI mounted in the chat. `browser_tabs` lists mounted ones. |

Ids resolve within the calling session's project. Each call first brings the view on screen, because layout, hit-testing, and screenshots need it visible: in the Activity panel when it is open, otherwise in a picture-in-picture over the chat that keeps the panel's layout. If the user hides that picture-in-picture, calls on the view fail until they show it again. A session the user is not viewing can only drive views already on screen; it cannot open tabs or previews in the user's workspace, so ask the user to switch to the session.

Snapshots, queries, actions (including `recording: true`), `wait_for`, `evaluate`, screenshots, viewport emulation, and the CDP network/perf/mock tools work as on a browser tab. `navigate` accepts only `action: "reload"`; SuperOne owns the view's URL, so opening, closing, and URL navigation are browser-only. Downloads are not listed, page-exposed WebMCP tools are not available, and site memory and saved flows are keyed by browser domains, so they do not apply to mini-app views.

## Console

`browser_snapshot` with `include: ["console"]` returns the view's console plus the app's MiniApp Host output, prefixed `[host]`: stdout, stderr, activation failures, tool errors, and unexpected exits. Host failures are kept apart from routine output, and a Host restart clears both. The default levels are `warning` and `error`; add `console: { level: ["log", "info", "warning", "error"] }` for logs and preview events.

## Edit loop

For UI work on a React template app, start `bun run dev` in a terminal tab and leave it running; add `--port <n>` if the default port is taken. While it runs, SuperOne serves the app panel and every tool UI of the app from the dev server, so saved front-end edits appear in open views without a reload, and the view's tab shows a lightning badge. When the server stops, the views load the last build again. Any dev server works the same way if it writes `.superone-dev-server.json` containing `{ "url": "http://localhost:<port>" }` to the registered source directory while it listens and connects its HMR client to `ws://localhost:<port>`.

`main` code and `manifest.json` changes always need a build and a reload:

1. Edit the source. Build it if the app has a build step (the React template needs `bun run build`).
2. Call `miniapp_dev_reload({ appId })`. It restarts the MiniApp Host so changed `main` code loads, refreshes manifest tools and templates, and reloads open views. `hostRestarted: false` means no Host was running; it starts from the new code on next use. `notReloaded` lists views that are not on screen; they load the new code when shown.
3. Check the result with `browser_snapshot`, `browser_act`, or a screenshot, and read the console.

## Tool UIs

`miniapp_dev_preview` renders one tool's chat UI from fixture data in a dock tab and returns `miniapp:<appId>:preview`:

- `phase`: `intercept`, `result`, or `standalone` (for `standalone: true` tools). Defaults to the result UI.
- `input` is the intercept data and the standalone args; `result` is the result data.
- `running: true` shows the standalone in-progress state; `width` narrows the column (try 360–480).

The tool never runs. Intercept `submit`/`cancel` and result `close` are recorded as info console entries such as `[preview] submit {"confirmed":true}`, so the submitted input can be checked against `inputMerge`. Each call replaces the app's previous preview.

To reproduce a problem with real data, run the tool through `miniapp_call` and target the chat instance from `browser_tabs`. Result renderers mount only while expanded (`autoExpand`). An intercept blocks the call that raised it, so check intercepts with the preview.
