# Backend: registering a SuperOne tool

Worked example: adding `note_pin`, a built-in SuperOne MCP tool. Write the files in this order —
each step compiles on its own, and the last step is the test that proves the first four agree.

## Contents

- [Agent-facing progressive disclosure](#agent-facing-progressive-disclosure)
- [Saving tokens](#saving-tokens)
- [1. Handler + test](#1-handler--test)
- [2. Description + JSON-Schema descriptor](#2-description--json-schema-descriptor)
- [3. Name allowlist (permission)](#3-name-allowlist-permission)
- [4. Zod registration + execute switch](#4-zod-registration--execute-switch)
- [5. Remote-node descriptor](#5-remote-node-descriptor)
- [6. Drift test](#6-drift-test)
- [Deps: what the handler can reach](#deps-what-the-handler-can-reach)
- [Human-in-the-loop confirmation](#human-in-the-loop-confirmation)
- [The own-descriptor path (browser / widget / computer-use)](#the-own-descriptor-path)
- [Manuals: shipping long-form guidance](#manuals-shipping-long-form-guidance)

## Agent-facing progressive disclosure

Tool **backend** is for the **agent** (finish the task). Tool **UI** is for the **human** (see what
happened). Do not confuse the two when shaping descriptions and results.

| | Agent (this file) | Human (`tool-ui.md`) |
|---|---|---|
| Unit of progressive disclosure | Always-on prompt tax vs on-demand tool results | Collapsed summary vs expand body |
| Success | Model gets **precise** next facts without drowning | User sees **what** happened in one glance |
| Failure mode | Context overload / wrong tool / stuck without a follow-up | Unreadable header or blank row |

### Design rules

1. **Precision over completeness.** A result should answer *this* call: the id, the hit list, the
   error and recovery, the next tool to call. It should not dump every related field "in case".
2. **Progressive load.** Expensive or large knowledge stays behind a second step the agent chooses:
   - Always-on: short description (≤700 chars), small required schema.
   - On demand: `read_manual`, `*_read` after `*_list`/`*_search`, status after submit, full body
     after a snippet.
3. **Handles, then content.** Discovery returns locators (ids, paths, short previews) and *names the
   detail tool*. Detail tools take those locators. Never fuse "search the world + return full text"
   into one default path.
4. **Errors are agent UX.** `[Error] …` should be actionable (what was missing, which sibling tool
   fixes it), not only a stack-shaped string.

### Patterns in this repo

| Pattern | Example | Why |
|---|---|---|
| Knowledge off the hot path | Description points at `read_manual({ domain, topic })` | Guide body loads only when needed |
| List / search → read | `session_list` / `session_search` → `session_read` | Snippets locate; read pulls content |
| Catalog → call | `miniapp_list` → `miniapp_call` | Fixed tool surface; app tools not all in context |
| Submit → status / start | `media_generate_video` → `media_video_status`; collab request → start | Handle first, redeem when ready |
| Domain parameter | `config_read({ domain })`, `read_manual({ domain, topic })` | One tool, agent scopes what to load |
| TOON flat tables | Homogeneous list rows | Smaller tokens for dense indexes — not nested blobs |

### Anti-patterns

| Smell | Instead |
|---|---|
| Single tool returns entire archive / full file tree / multi-KB policy | Index + detail tools; manual topics |
| Description is a tutorial | Boundaries + "call X next"; depth in `read_manual` |
| "Helpful" result includes full prompt, full transcript, all options | Truncate / snippet / field the agent asked for |
| Skip the follow-up tool to save a round trip | Ship the pair; round trips beat context death |

Registration (sections below) makes the tool *exist* on every harness. The rules above make the tool
*usable* without burning the session's context budget. Encoding and spill tactics below cut tokens
*within* a single result when the progressive ladder still needs to return data.

## Saving tokens

Progressive disclosure decides *what* to return. These tactics shrink *how* it is encoded once you
must return something.

### TOON for list-shaped data

Use `@toon-format/toon` (`encode`) for **flat, homogeneous** arrays of rows — the same keys repeated
many times. TOON's tabular form drops repeated key names and usually beats JSON on token count.

In-repo:

- Session archive list/search → `toonResult` in `session-archive-tools.ts`
- Browser data tools (tabs, snapshot rows, network lists) → `toonReply` in `browser-mcp-tools.ts`
- Computer-use list-shaped replies → `toonEncode` in `computer-use/tools.ts`

```ts
import { encode as toonEncode } from '@toon-format/toon'

function toonResult(value: unknown) {
  return toolResult(toonEncode(value))
}

// Good: array of same-shape hits
return toonResult({ query, count: hits.length, hits })
```

**Only when the payload is table-like.** Nested objects, free-form trees, or one-off records often
encode *larger* as TOON than as JSON — flatten to a row table first, or stay on JSON/markdown.

If the Tool UI must parse the result, support TOON in the block (`tryParseToon`) the same way
archive/computer blocks do — do not assume JSON.

### Spill large content to a file

When a single field can blow past a few tens of KB (HTTP body, long HTML, huge text dump), **do not
inline it**. Write it to disk and return a small envelope the agent can act on:

| Field | Role |
|---|---|
| `path` | Absolute path — agent uses harness `Read` / grep / other tools if it needs the full body |
| `preview` | First ~N chars so the agent can decide whether to open the file |
| `bytes` / size | Scale signal without loading the blob |
| `spilled: true` | Explicit that content is not inline |

Canonical helper: `spillLargeBrowserField` in `browser-mcp-artifacts.ts` (limit ~32KB inline, ~600
char preview, `persistTextArtifact`). Screenshots follow the same idea: save image, return path +
dimensions — description tells the model the image is **not** auto-loaded; call `Read` on the path
only when pixels matter.

```ts
// Shape of a spilled reply (conceptually)
{
  spilled: true,
  path: '/…/artifact-….txt',
  bytes: 180_000,
  preview: '…first ~600 chars…',
  // other small metadata fields stay inline
}
```

**When not to spill:** live data that is cheaper to re-query than to persist (browser DOM snapshot
stays at the source — comment in `browser-mcp-artifacts.ts`). Prefer a second scoped tool call over
a permanent artifact when the agent can refine the query.

**Description must name the recovery path:** if you return a path, say the agent should `Read` (or
your detail tool) for full content — same rule as handle + follow-up tool.

### Other cheap wins

| Tactic | Notes |
|---|---|
| Cap list `limit` server-side | Default low, hard max; never advertise a huge maxLength for free text |
| Shorten paths / ids in rows | Basename + id; full path only when needed for the next Read |
| Prefer text tools over screenshots | Snapshot/query before pixels (browser tool descriptions already say this) |
| Markdown only when prose is the product | Structured indexes → TOON/JSON; narratives → short markdown |
| Truncate with an explicit flag | `truncated: true` + how to get more beats silent cut |

## 1. Handler + test

`apps/desktop/src/main/mcp/note-tools.ts` — one file per tool family, one exported handler per tool.

```ts
import type { BuiltInSuperoneToolDeps } from './superone-mcp-builtins'

export interface NotePinArgs {
  noteId: string
  pinned?: boolean
}

function toolResult(value: unknown, isError = false) {
  return {
    content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value) }],
    ...(isError ? { isError: true as const } : {}),
  }
}

export async function notePinHandler(args: NotePinArgs, deps: BuiltInSuperoneToolDeps) {
  const session = deps.sessionHost?.getSession(deps.sessionId)
  if (!session?.projectPath) return toolResult('[Error] No project is open for this session.', true)

  const note = await findNote(session.projectPath, args.noteId)
  if (!note) return toolResult(`[Error] Note ${args.noteId} not found.`, true)

  await setPinned(note, args.pinned ?? true)
  return toolResult({ noteId: note.id, pinned: args.pinned ?? true })
}
```

Notes:

- **Expected failure → `isError: true`**, never `throw`. A throw crosses the harness boundary as an
  opaque error; `isError` reaches the model as text it can act on, and reaches the UI as a red row.
- The `[Error] ` prefix is the house convention (see `superone-mcp-tool-surface.ts`), and some UI
  paths key off it. Prefer messages that steer the next call (e.g. "not found — list with note_list").
- Return the **smallest precise payload** that completes the agent's step (here: `noteId` + `pinned`),
  not the full note body unless the tool is a read.
- Write `note-tools.test.ts` first. Handlers take their host through `deps`, so tests pass a stub
  `sessionHost` and never boot Electron.

## 2. Description + JSON-Schema descriptor

`apps/desktop/src/main/mcp/superone-mcp-builtin-defs.ts` — descriptions are exported consts so tests
and the host-action mirror can reference the same string.

```ts
export const NOTE_PIN_DESCRIPTION =
  'Pin or unpin a project note so it stays at the top of the notes panel. ' +
  'Use after the user says a note matters or should be kept handy. ' +
  'This only reorders the panel — it does not edit note content (use note_write) and does not affect session pinning (session_list).'

// … in BUILT_IN_SUPERONE_TOOL_DEFS
  {
    name: 'note_pin',
    description: NOTE_PIN_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        noteId: { type: 'string', description: 'Note id from note_list.' },
        pinned: { type: 'boolean', description: 'Defaults to true. Pass false to unpin.' },
      },
      required: ['noteId'],
      additionalProperties: false,
    },
  },
```

This descriptor is what the **stdio bridge** serves to Codex / ACP / OpenCode. It is JSON Schema, not
Zod, because those harnesses receive it over the wire.

`_meta: { 'anthropic/alwaysLoad': true }` opts a tool out of Claude's Tool Search deferral — the tool
stays in every prompt instead of needing a search first. `read_manual` uses it (and a test asserts it)
because it is the entry point to everything else. Use it sparingly: it is the most expensive flag in
this file.

## 3. Name allowlist (permission)

`packages/shared/src/superone-host-owned-tools.ts`:

```ts
export const BUILT_IN_SUPERONE_TOOL_NAMES = [
  'read_manual',
  // …
  'note_pin',
  ...BROWSER_TOOL_NAMES,
] as const
```

This one list drives, on all harnesses at once:

| Consumer | File |
|---|---|
| Claude `canUseTool` short-circuit | `packages/claude/src/run-sdk-turn.ts`, `packages/claude/src/claude-live-session.ts` |
| Codex elicitation rewrite + auto-approve | `apps/desktop/src/main/codex/codex-turn.ts` |
| ACP pre-approve | `apps/desktop/src/main/acp/acp-permission-preapprove.ts` |
| OpenCode allow rules | `listOpenCodeAutoAllowSuperoneBareNames()` in `apps/desktop/src/main/mcp/superone-host-owned-tools.ts` |
| Claude permission layer | `apps/desktop/src/main/agent/claude-permissions.ts` |

It lives in `packages/shared` (not desktop) so a remote CLI node can make the same judgement without
Electron. The desktop module of the same name re-exports it and layers computer-use feature gating on
top — add feature-gated names there, static ones in shared.

## 4. Zod registration + execute switch

`apps/desktop/src/main/mcp/superone-mcp-builtins.ts` — **two** edits, both required.

```ts
// (a) execute switch — used by the stdio surface (Codex/ACP/OpenCode) and remote-node dispatch
export async function executeBuiltInSuperoneTool(toolName, args, deps) {
  switch (toolName) {
    // …
    case 'note_pin':
      return notePinHandler(args as unknown as NotePinArgs, deps)
  }
}

// (b) Zod registration — used by the in-process MCP server Claude talks to
export function registerSuperoneTools(server: McpServer, deps: BuiltInSuperoneToolDeps): void {
  server.registerTool(
    'note_pin',
    {
      description: NOTE_PIN_DESCRIPTION,
      inputSchema: {
        noteId: z.string().min(1).describe('Note id from note_list.'),
        pinned: z.boolean().optional().describe('Defaults to true. Pass false to unpin.'),
      },
    },
    (args) => notePinHandler(args, deps),
  )
}
```

The Zod schema and the JSON Schema from step 2 must describe the same shape with the same field
descriptions. They cannot be generated from each other today; the drift test is what keeps them
honest.

For a heavy dependency, register lazily so it stays off the startup path — the collaboration tools do
`async () => { const { fn } = await import('../session/session-collaboration'); … }`.

`superone-mcp-tool-surface.ts` needs **no** edit: `listSuperoneMcpTools` spreads
`BUILT_IN_SUPERONE_TOOL_DEFS` and `executeSuperoneMcpTool` routes anything in
`BUILT_IN_SUPERONE_TOOL_NAMES` into `executeBuiltInSuperoneTool`.

## 5. Remote-node descriptor

`packages/shared/src/environment/host-action-superone-descriptors.ts` is the tool surface a **remote
node** (the `superone` CLI) advertises for host-delegated tools. Its header says "regenerate when the
SuperOne MCP tool surface changes"; in practice you append the same JSON descriptor as step 2, with
the description string copied **verbatim** — the drift tests compare with `toEqual`, so a reworded
copy fails.

Only add the tool here if it makes sense on a remote node. A tool that manipulates desktop-only UI
state does not; one that reads session data does.

## 6. Drift test

`apps/desktop/src/main/mcp/superone-mcp-builtin-defs.test.ts` already enforces the generic
invariants. Add assertions for anything tool-specific that could silently regress:

```ts
it('keeps note_pin pointed at note_list for ids and away from session pinning', () => {
  const def = BUILT_IN_SUPERONE_TOOL_DEFS.find((d) => d.name === 'note_pin')!
  expect(def.inputSchema.required).toEqual(['noteId'])
  expect(def.description).toMatch(/note_list/)
  expect(def.description).toMatch(/does not affect session pinning/)
})
```

If the tool belongs to a family that is mirrored onto the host-action surface, add its name to the
family list (`SESSION_ARCHIVE_TOOL_NAMES`-style) so the existing "descriptors stay aligned" test
covers it for free — that is cheaper than writing a new comparison.

Run it from `apps/desktop`:

```bash
cd apps/desktop && bunx vitest run src/main/mcp/superone-mcp-builtin-defs.test.ts
```

## Deps: what the handler can reach

```ts
export interface BuiltInSuperoneToolDeps {
  notifyDevAppReady: (projectDir: string, appId: string) => void
  sessionId: string
  sessionHost: SessionTitleHost | null   // .getSession(id) → { setTitle, projectPath, emitHostEvent, injectTaskNotification }
  applyAppSettings: (patch: AppSettingsPatch) => Promise<AppSettings> | AppSettings
  signal?: AbortSignal
}
```

Extend this interface rather than importing main-process singletons into a handler — that is the
seam that keeps handlers unit-testable and lets the same handler run on a remote node.

Useful members on the session object:

- `emitHostEvent(event)` — push an `AgentEvent` from inside a tool (progress, task lifecycle).
- `injectTaskNotification(content)` — wake the agent with a non-human message when async work lands.
- `signal` — honour it for anything long-running; the turn can be interrupted.

## Human-in-the-loop confirmation

When a tool must ask the user mid-execution, use `HostConfirmRegistry`
(`apps/desktop/src/main/session/host-confirm-registry.ts`) — do not hand-roll a pending-promise Map.

The renderer keeps the dialog in `pendingPermissions` until it sees an `interaction_resolved` with the
same requestId. So *every* terminal path — answer, external cancel, timeout, turn abort — must emit
that event, or the tool call finishes while a dead dialog sits on screen. The registry makes settling
reachable only through `take()`, which clears the timer, drops the entry, and emits in one step.

Existing users: `config_apply`, `media_generate_video`, `miniapp_call`, computer-use grants. Copy the
closest one.

## The own-descriptor path

Browser, widget, computer-use, and mobile-share tools deliberately skip the built-in machinery. They
expose their own descriptor getters that **both** `superone-mcp-server.ts` (Claude, in-process) and
`superone-mcp-stdio-bridge.ts` (Codex) call directly, plus an explicit branch in
`superone-mcp-tool-surface.ts`.

Choose this path when the family is large enough that one entry per tool in
`BUILT_IN_SUPERONE_TOOL_DEFS` would bury the file (browser has ~30), or when registration is
conditional on a runtime setting (`isComputerUseEnabled()`, `isMobileShareToolEnabled(sessionId)`).
The names still belong in `BUILT_IN_SUPERONE_TOOL_NAMES` (or the desktop feature-gated layer) for
permission — the `SEPARATELY_DESCRIBED` prefix list in the drift test is how a family declares it has
opted out of the descriptor half only.

Pattern, from `browser-mcp-tools.ts`:

```ts
export function getBrowserToolDescriptors(): SuperoneMcpToolDescriptor[] { /* … */ }
export function isBrowserToolName(name: string): boolean { /* … */ }
export async function executeBrowserTool(sessionId, name, args) { /* … */ }
```

…wired into `listSuperoneMcpTools` / `executeSuperoneMcpTool` as a prefix branch.

## Manuals: shipping long-form guidance

Manuals are the main **progressive-load** path for knowledge (not for side-effecting actions). Detail
that does not fit the 700-char description goes to a topic instead of a bigger always-on schema:

1. Write `apps/desktop/src/main/mcp/guides/<domain>/<topic>.md`.
2. Add the topic to the domain list in `superone-mcp-builtin-defs.ts`
   (`PRODUCT_GUIDE_TOPICS`, `MINIAPP_GUIDE_TOPICS`, `MEDIA_GUIDE_TOPICS`, …).
3. Mention it in `MANUAL_READ_DESCRIPTION` **only** if the model needs to know it exists before it has
   a reason to look — that string is always in context, so each addition costs every turn.
4. Point at it from the tool description: `call read_manual({ domain: "x", topic: "y" }) before …`.

This is the cheapest way to give a tool a lot of guidance: the words load only when the model decides
it needs them. Prefer a **topic per concern** over one giant guide so the agent can pull only the
slice it needs.
