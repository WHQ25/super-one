# Claude Code mods

Claude Code mods (2.1.287+) are plugins whose hooks module runs inside the CLI
and can draw: panes, a band above the composer, rewritten transcript rows,
status text, interactive `Client` parts, and edits to the draft. SuperOne
hosts that UI the way Claude Desktop does, on desktop, on the phone and for
sessions on a remote node. Upstream docs:
<https://code.claude.com/docs/en/plugins/mods/overview>.

Only the Claude harness has it (`HarnessCapabilities.modUi`); every other
harness answers `mod-ui-unavailable` and draws its own components. Mod hooks
run in every Claude session whether or not SuperOne draws anything. The wire
is private to the CLI; what SuperOne relies on is in the Claude
[contracts](../harness/claude/contracts.md#mod-ui-rides-a-private-control-protocol).

## What draws where

| CLI site | Desktop | Phone |
|---|---|---|
| `Pane` | A tab in the activity dock (choosing the tab shows that pane to the CLI); with the dock hidden, inline above the composer (tabs when several, at most a third of the window) | At the top of the bottom dock above the composer, with tabs and close |
| `AbovePrompt` | The band above the composer (8 rows), digit hotkeys from an empty composer | Not drawn |
| `UserMessage`, `AssistantMessage` | Around each user row and each assistant text block | Same |
| `ToolUse`, `ToolGroup` | Around each tool row and tool group (the row includes its result, so `ToolResult` is not asked) | Same |
| `CommandOutput` | Around the slash-command output popup | Around the command output card above the composer |
| `AskUserQuestion` | Around the question prompt; a tree without exactly one engine ref draws SuperOne's own | Same, around the question form above the composer |
| `Spinner` | The working word in the message footer, shown only when rewritten | — |
| `SessionMode` | In the composer toolbar, left of the context ring. The terminal footer shows session-state labels there ("memory paused", "account memory: off"); SuperOne has none, so only a mod draws there | — |
| `PromptHint` | The composer placeholder: SuperOne's own placeholder is the `hint` a mod reads, and a mod's hint replaces it. Under a prompt suggestion it is the ghost's second line (Tab takes only the suggestion). The terminal footer shows it while typing too; SuperOne shows it only while the composer is empty | — |
| `Client` | Runs in a sandboxed frame (below) | Stripped by the CLI |

A tree's `engine` node is SuperOne's own component; the first non-zero ref
draws with the plugin's rewritten props. On the decision sites (`engineOnce`)
that component stays mounted while the tree around it comes, changes and goes,
so a half-filled question keeps its answers. Elements: Box, Text, Button,
Input, Select, Link, Code (with diffs), Markdown, Svg (sanitized, `style`
attributes dropped, drawn as an image) and Client. Each element's props are
checked against what the renderer reads before anything draws; string sizes
must be percents, and a wrapped transcript site clips the tree to its own
box, so a mod cannot draw over SuperOne's cards or composer. Plugin requests are answered too: `$.prompt.read` / `fill` (with
decoration runs) / `suggest` and `$.ui.copy` on desktop; `copy` and a
replacing `fill` on the phone. Toasts are held while a `holdToasts` pane is
shown, as in the terminal; a hotkey draws its button pressed for a moment so
a press whose only effect is a held toast still shows. `$.ui.ask` and the dev-folder consent use the existing question prompt.

## Surfaces and clients

- **Desktop** attaches each Claude session it shows as surface `desktop`,
  client `superone-desktop`, reporting the window's columns with
  `isFullscreen: true`, so the CLI always places a pane. Tiles and windows on
  one session share the client.
- **Phone** attaches as `mobile`, client `mobile-<deviceId>`. Its requests go
  through the RemoteCommand `mod_ui_request`; the desktop checks session access
  and stamps the surface and client id, so a phone can only speak as itself.
  A device that disconnects is detached from every session it attached to.
  Sessions on a remote node do not draw on the phone. Panes, the command
  output and the question form share the chat document's bottom dock, so the
  question (`AskUserQuestionForm`, shared with the desktop) and the output wrap
  with the one renderer through `ModQuestionSite` / `ModCommandOutputSite`.
- **Remote node** hosts the adapter in its live session; the desktop calls RPC
  `session.modUi`. Ops that change what a plugin sees (`MOD_UI_MUTATING_OPS`)
  need the control lease and an idempotency key, so a retried press runs once.
  The node runs every op under the caller's pairing (`<clientId>.<pairing>`)
  and `session.events` reads those ids back as the caller's own, so two
  desktops on one node keep separate clients. The desktop pulls the node's
  events after attaching and after each such op, since an idle session has no
  drain running.

## How it is built

- `packages/claude/src/mod-surface/` is the adapter: it sends the CLI's `ui_*`
  requests, maps its pushes to `mod_*` AgentEvents (state, panes, invalidate,
  scroll, focus, host requests), and answers CLI→host requests through the
  attached client, never with an error. Only the client a request went to may
  answer it, and a node serves a `mod_host_request` from its event log only
  while the CLI still waits for it, so a late reader never replays a copy or
  fill.
- Every runtime reaches it through one gateway op, `modUi(op, request)`:
  desktop IPC `environment:modUi`, node RPC `session.modUi`, phone
  `mod_ui_request`.
- `packages/chat-view/src/mod-ui/` is shared by desktop and the phone's chat
  view: `ModUiClient` keeps one cache entry per site instance, asks once per
  component to learn whether it is hooked (an unhooked component costs no
  further asks or prop serialization), and re-asks only the instances a
  narrowed invalidation names. `ModSite`, `ModSurfaceFrame` and `ModTree` draw
  the result; `site-props.ts` builds each site's props.
- Desktop glue is `apps/desktop/src/renderer/src/lib/mod-ui/` (client per
  session, host-request answers, composer bridge) and
  `components/chat/mod/` (panes, band, keys, status sites).

### `Client` parts

A `Client` element runs the plugin's surface module. SuperOne fetches the
plugin's modules once per hash and runs them with the CLI's own surface
runtime in an opaque `srcdoc` frame: `sandbox="allow-scripts"`, a nonce-only
CSP (`default-src 'none'`), no network, modules loaded as blob URLs inside the
frame. The frame returns tree JSON that SuperOne validates against the CLI's
bounds and draws with the same renderer. Timers run on the host's clock,
pointer events are sent in the Client's cells, keys while it holds focus
(Escape hands them back). Buttons, inputs and selects go through
`ui_client_press`; `surface.post` goes through `ui_message`, whose answered
props reach the module. A throw, an oversize tree, a render loop, more than 32
live timers, more than 60 posts a second or navigating the frame away unmounts
it and leaves a fault line.

### Draft edits (`prompt.edit`)

Local desktop sessions relay each composer edit (`ui_prompt_edit`, with the key
that made it), one in flight, newer edits collapsed. An answer repaints the
draft only while the composer still holds the box it answers; a draft with
mentions or attachments keeps its text and takes only the decoration runs.
Fills, restores and submits are sent as `by: 'app'`. Remote-node composers and
the phone do not relay edits.

## Settings and management

- **Draw Mod Interfaces** (Settings → Harnesses → Claude → Preferences), on by
  default. Off: no client attaches (turning it off detaches the desktop's
  clients, remote sessions included; on attaches them again), every site
  draws SuperOne's own, hooks still run.
- **Mod Development Folders** (same page) loads mods from disk through
  `CLAUDE_CODE_PLUGIN_DIRS` with hot reload. It is spawn-time, so Claude
  sessions rebuild on their next turn. Claude Code asks once per folder before
  running it; reload lines show as plugin notices.
- **Plugins page** (Claude): an enable switch per plugin (writes
  `enabledPlugins` in user settings, then reloads live sessions; on a remote
  node through RPC `plugins.setEnabled`), "N mods active", the hooks and calls
  each mod module declares with flags for hooks that can approve tool calls or
  submit prompts (`claude plugin validate --json`, cached per install path and
  version), and the plugin's `userConfig` form (`pluginConfigs` in user
  settings; sensitive values stay in the keychain). The review and the form
  are for this Mac's plugins only.
- A reload's `error_count` shows a notice, and the slash list follows
  `system/commands_changed`.

## Not supported

- Button `action` keybindings and the `onScreen` window for transcript sites.
- `TurnDuration` and other terminal-only sites (the CLI reports them unhooked).
- Commands registered `immediate: true` queue behind a running turn: the SDK
  command list does not carry the flag.
- With desktop and phone both attached, the CLI sends a host request to the
  first client that answers that kind.

Open items are tracked in the Claude [backlog](../harness/claude/backlog.md)
(G5–G7).

## Stories

`apps/desktop/src/renderer/src/components/chat/mod/ModSurfaces.stories.tsx`
(Chat/Mods: pane elements, narrow, long, hold, loading, error, a running
`Client` and its fault, band, above-prompt inline panes / single narrow pane /
band hotkeys / empty, session mode labels and long, pane closed, footer
spinner original and rewritten, user-message wrap / rewrite / replace / off,
question wrapped (keyboard and touch) or refused, command output rewritten or
wrapped), `packages/chat-view/src/bottom-dock.stories.tsx` (Chat/Mobile bottom
dock: the phone's question and command output cards) and
`apps/desktop/src/renderer/src/components/PluginsPage.stories.tsx` (installed
mods, review and options, review loading and unavailable).
