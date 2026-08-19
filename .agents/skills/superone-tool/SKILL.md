---
name: superone-tool
description: "How to design, implement, register, and render an agent-facing tool in SuperOne — the built-in SuperOne MCP surface (mcp__superone__*) plus its chat Tool UI. Use this skill whenever the user wants to add, change, remove, review, or debug a SuperOne tool: new MCP tool, new tool parameter, tool description/prompt wording, tool result shape, tool permission/auto-approve, a custom ToolBlock in chat, or 'the model isn't calling my tool' / 'the tool works in Claude but not Codex' / 'the tool row looks wrong in chat'. Also use it before adding any new agent-facing capability, to decide whether it should be a new tool at all."
---

# Building a Tool in SuperOne

A SuperOne tool is not one function. It is a **contract that must hold on five surfaces at once**: the
prompt the model reads, four harness registration paths, the permission layer, the chat UI, and the
mobile event stream. Every recurring bug in this area is one surface drifting from the others — and
because a missing surface fails *silently* (the tool just doesn't appear, in one harness only), the
drift is usually found by a user, not by a crash.

So the work is less "write a handler" and more "keep five copies of one truth in sync, and let tests
hold that invariant instead of your memory."

## Two audiences, one progressive-disclosure idea

| Surface | Audience | Goal |
|---|---|---|
| **Tool backend** (name, description, schema, result) | The **agent** | Finish the user task — precise, actionable context when needed |
| **Tool UI** (chat row / block) | The **human** | Observe what the agent did — short summary, expand for detail |

Both use progressive disclosure, but the unit differs:

- **UI** — collapsed header vs expand body (what the user reads).
- **Backend** — what sits in every turn vs what the agent **pulls on demand** (what the model reads).

### Agent context: precise + progressive

Tools exist so the agent can complete work better. Design the agent-facing contract so that:

1. **Precision** — each result answers the call the agent made (ids, next step, actionable error), not
   a dump of everything the host could serialize.
2. **Progressive load** — do **not** pour a corpus into one tool call or into always-on descriptions.
   Let the agent fetch the next layer only when it needs it.
3. **Navigation, not payload** — discovery tools return *handles and short previews* plus an explicit
   follow-up tool; detail tools take those handles and return full content.

Concrete ladders already in the product:

| Layer (cheap / always or list) | Next layer (on demand) |
|---|---|
| Short tool description (≤700 chars) + field hints | `read_manual({ domain, topic })` for long policy |
| `session_list` / `session_search` snippets | `session_read` for full transcript slices |
| `miniapp_list` catalog | `miniapp_call` for a specific app tool |
| `media_generate_video` → job id | `media_video_status` until done |
| Guide topic index / pointer in description | Only the chosen guide body |

Anti-goal: one mega-tool or one mega-result that "saves a round trip" by stuffing the context window.
Round trips are cheap; silent context blowouts are not.

**Token-saving tactics** (details in `references/backend.md`):

- **TOON for flat tables** — homogeneous list rows via `@toon-format/toon` (session archive hits,
  browser tabs/snapshot rows). Nested objects usually lose to JSON — flatten first or skip.
- **Spill large blobs to disk** — write oversized text/binary to a file; return `path` + short
  `preview` + size. Agent uses Read / other tools only if it needs the full body (browser
  `spillLargeBrowserField`, screenshots that return a path not pixels).
- Prefer re-query live sources over persisting when re-fetch is cheaper than a giant artifact.

Read `references/backend.md` → **Agent-facing progressive disclosure** and **Saving tokens** for the
full pattern.

## Step 0 — Should this be a tool at all?

Ask before writing code. Every tool name permanently occupies context in every turn of every session,
on every harness. The tool list is a shared budget.

Prefer, in order:

1. **A parameter on an existing tool.** `config_read({ domain })` beats eight `config_read_*` tools.
2. **A manual topic.** If the model needs *knowledge*, not an *action*, add a guide under
   `apps/desktop/src/main/mcp/guides/<domain>/<topic>.md` and a topic entry — `read_manual` already
   exists and costs nothing extra (body loads only when called).
3. **A fixed dispatcher over dynamic registration.** Mini-apps used to register one MCP tool per
   app-tool (`slug__tool`). That surface grew without bound and forced Codex tool-list reloads, so it
   collapsed into exactly two fixed tools, `miniapp_list` + `miniapp_call`
   (`apps/desktop/src/main/mcp/miniapp-mcp-tools.ts`). Codex snapshots `tools/list` once per session
   and ignores `list_changed`, so **a tool surface that changes at runtime is a liability**.
4. **A new tool** — only when it is a genuinely distinct action with a distinct result shape.

If the capability is a new *action* the model must be able to take, and it does not fit any existing
tool's parameter space without turning that tool into a mode switch, then yes: new tool.

## The five surfaces

| # | Surface | Where | What breaks if you skip it |
|---|---|---|---|
| 1 | Host-owned admission set | `packages/shared/src/superone-host-owned-tools.ts` → `STATIC_HOST_OWNED_SUPERONE_QUALIFIED_TOOL_NAMES` | Auto-review may prompt for or refuse the tool before its executor runs |
| 2 | JSON-Schema descriptor | `apps/desktop/src/main/mcp/superone-mcp-builtin-defs.ts` → `BUILT_IN_SUPERONE_TOOL_DEFS` | Invisible to Codex / ACP / OpenCode (stdio bridge), works fine in Claude |
| 3 | Zod registration + execute switch | `apps/desktop/src/main/mcp/superone-mcp-builtins.ts` | Invisible to Claude (in-process SDK server) / `Unknown SuperOne MCP tool` at call time |
| 4 | Remote-node descriptor | `packages/shared/src/environment/host-action-superone-descriptors.ts` | Missing when the session runs on a remote node (CLI) |
| 5 | Chat Tool UI | `apps/desktop/src/renderer/src/components/chat/` | Unhandled SuperOne tools fall back to a generic MCP row (plumbing, not a design). User cannot tell what the call did |

`apps/desktop/src/main/mcp/superone-mcp-tool-surface.ts` needs **no** edit for a built-in: it spreads
`BUILT_IN_SUPERONE_TOOL_DEFS` and dispatches by `BUILT_IN_SUPERONE_TOOL_NAMES`. Only tools that opt
out of the built-in machinery (browser, widget, computer-use, mobile share) carry their own
descriptors and need an explicit branch there.

Read `references/backend.md` for the file-by-file code, in the order to write it.

## Step 1 — Design the contract before writing the handler

Design for the **agent** first: what does it need to decide and act, and what should stay behind a
follow-up call? (Tool UI is Step 4 — human observability.)

### Permission design comes before name and schema

Before writing a descriptor or handler, record two independent decisions:

1. **Harness admission:** is this a static SuperOne-owned dispatcher, a feature-gated host tool, or
   a dynamic/third-party tool? This decides whether the exact name belongs in the shared host-owned
   set, is conditionally allowed, or must follow normal/args-aware permission handling.
2. **Executor authorization:** what can one successful call cost the user? Reads and reversible
   SuperOne-state writes can proceed; disabled capabilities fail closed; destructive, paid,
   autonomous, app-reshaping, or third-party effects require a host confirmation inside the
   executor.

These answers are deliberately independent. `session_cleanup`, `config_apply`,
`media_generate_video`, `session_collab_request`, and the fixed `miniapp_call` dispatcher should be
admitted by every harness so their executors are reachable, but their sensitive effects remain
gated inside those executors. Never omit a host-owned name from the admission set as a substitute
for implementing the product confirmation: auto modes may deny it before SuperOne can show the
correct prompt, while bypass modes may remove the harness prompt entirely.

Write tests for the chosen policy before the handler: admission-set membership (or deliberate
absence), feature-off behavior, and no-effect decline/cancel/abort cases for executor confirmation.

### Name

`<domain>_<verb>[_<object>]`, snake_case: `session_list`, `media_generate_image`, `config_apply`,
`miniapp_dev_setup`. The domain prefix is doing real work — it groups the tool in an alphabetical
tool list and lets the permission/UI layers match by prefix. Never invent a second domain word for a
capability that already has one.

### Description — this is a prompt, not documentation

The description is the *only* thing most models read before deciding to call. Two rules follow:

- **Budget: 700 characters**, enforced by `superone-mcp-builtin-defs.test.ts`. Descriptions sit in
  context for the whole session; a verbose one taxes every turn. Long-form goes in a `read_manual`
  guide, and the description *points at it* (progressive load of knowledge).
- **Say when NOT to use it, and what to call next.** The failure mode isn't "model can't parse the
  description", it's "model picked the wrong tool" or "model stopped one step early". Real examples:
  - `session_list`: *"This is content archive lookup — not live collab (`session_collab_*`) and not
    harness-native resume."* — negative boundary against two sibling tools.
  - `media_generate_video`: its description **must** mention `media_video_status`, asserted by a test,
    because the submit tool returns an id rather than a file. A tool that hands back a handle is
    useless unless the description names its follow-up.
  - `session_collab_request`: *"Before setting config.cwd or config.worktree, call
    `read_manual({ domain: "product", topic: "collaboration" })`"* — offload detail, keep the pointer.

Per-field guidance goes in the **field** `description` (JSON Schema) / `.describe()` (Zod), which is
outside the 700-char budget and only loaded when the model inspects the schema. That's why
`LAUNCH_PERMISSION_MODE_DESCRIPTION` lives on the field, not in the tool description.

### Input schema

- **`required` is the smallest set that makes the call meaningful.** Every required field is a chance
  for the model to stall asking the user.
- **`additionalProperties: false`** — catches model typos as errors instead of silently ignored args.
- **`enum` over free string** whenever the value set is closed. It converts a class of runtime errors
  into "the model literally cannot express it".
- **Keep hard caps server-side.** `session_collab_request.task` has `minLength: 1` and deliberately
  *no* `maxLength` — the test asserts its absence. Advertising `maxLength: 100000` teaches the model a
  number it will try to fill.
- Descriptions and schemas must be **byte-identical** between the desktop def and the host-action
  descriptor. The tests in `superone-mcp-builtin-defs.test.ts` compare them with `toEqual`.

### Result shape — precise context, progressive load

Everything returns MCP content, not a thrown value:

```ts
function toolResult(value: unknown, isError = false) {
  return {
    content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value) }],
    ...(isError ? { isError: true as const } : {}),
  }
}
```

- **Expected failures return `isError: true`** with a readable `[Error] …` message. `throw` is reserved
  for "this should be unreachable" (unknown tool name, missing host). Prefer errors that tell the
  agent what to try next (missing id → which list tool; wrong mode → sibling tool name).
- **The result is read by two consumers**: the model (primary for backend design), and the Tool UI.
  If the UI needs structure, emit JSON; if the model needs prose, emit markdown. Emitting JSON *and*
  expecting the UI to regex it is how the block breaks later.
- **Snippets / indexes, not full payloads, for discovery.** `session_search` returns short locating
  snippets and tells the model to call `session_read` for content. A tool that returns everything
  "to be helpful" turns one call into a context blowout and steals budget from the real task.
- **Return handles + next step**, not completed mega-bundles, when work or data is large (job ids,
  session ids, paths, credentials) — and ship the redeem tool in the same change (below).
- **Encoding / spill** — see **Saving tokens** in `references/backend.md`: TOON for flat list tables;
  spill multi-KB fields to a file and return path + preview so the agent can `Read` on demand.

### Pairs must ship together

If a tool returns a handle (job id, credential), the tool that redeems it ships in the same change and
is named in the first one's description. `media_generate_video` / `media_video_status` and
`session_collab_request` / `session_collab_start` both have tests asserting the pair exists. This is
progressive disclosure for async / multi-step work: submit cheap, poll or start when ready.

## Step 2 — Implement the handler (TDD, per repo convention)

One file per tool family under `apps/desktop/src/main/mcp/<family>-tools.ts`, exporting one
`xxxHandler(args, deps)` per tool plus its `Args` type, with a co-located `<family>-tools.test.ts`.
Write the test first — see `apps/desktop/CLAUDE.md` for the layering rules (integration-first).

Handlers receive `BuiltInSuperoneToolDeps`: `sessionId`, `sessionHost`, `applyAppSettings`,
`notifyDevAppReady`, `signal`. If your tool needs something else from the host, extend that interface
rather than importing app singletons into the handler — that is what keeps the handlers testable.

## Step 3 — Permission

Permission has the same two layers chosen in Step 1:

| Layer | Class | Mechanism |
|---|---|---|
| Harness admission | **Static host-owned** | exact name in the shared static set; each harness pre-allows it before auto-review |
| Harness admission | **Feature-gated host-owned** | recognize the name always; pre-allow only while enabled (`computer_*`) |
| Harness admission | **Dynamic / third-party** | normal harness permission or args-aware preapproval; never approve by server/prefix |
| Executor authorization | **No confirm** | reads and reversible writes to SuperOne's own state |
| Executor authorization | **Feature check** | fail closed when the capability is disabled |
| Executor authorization | **Mandatory host confirm** | host `permission_request` raised **inside the executor** before any effect |

`STATIC_HOST_OWNED_SUPERONE_QUALIFIED_TOOL_NAMES`, derived from
`BUILT_IN_SUPERONE_TOOL_NAMES` plus the fixed host dispatchers, is the single static admission set.
It feeds upstream rules such as Claude `allowedTools` and Codex per-tool `approval_mode`; shared
predicates remain the downstream fallback for Claude `canUseTool`, Codex elicitation, ACP, and other
permission callbacks. Feature-gated `computer_*` stays outside the static set. Dynamic mini-app
tools (`slug__tool`) are never made host-owned merely because they use the `superone` MCP server.

### Mandatory confirm — sensitive effects must ask a human, unbypassably

Apply this tier when a call can:

- **destroy data irreversibly** — `session_cleanup` (delete), any overwrite the user can't undo;
- **spend the user's money or quota** — `media_generate_video` and any paid generation;
- **spawn autonomous work** — `session_collab_request` starts sub-sessions that then act and burn
  tokens on their own (`session_agents_confirm`);
- **hand control to a third party or reshape the app** — non-preapproved `miniapp_call`, `config_apply`.

For these, **the harness permission layer is not a control you may rely on**. Every prompt it would
raise is legitimately removable, and mostly *already* removed:

| Bypass | Why the prompt disappears |
|---|---|
| Membership in the static host-owned admission set | every integrated harness pre-allows that exact set before or inside its permission path |
| `bypassPermissions` permission mode | the harness stops asking at all |
| Codex elicitation auto-accept | `codex-turn.ts` auto-accepts elicitations from any `isBuiltInSuperoneTool` name (only rich-confirm payloads are exempted) — so **never model the confirm as an MCP elicitation** |
| `alwaysAllow` | one earlier click silences every later call |

The unbypassable path is a host `permission_request` emitted from **inside the handler**: outbound via
`Session.emitHostEvent` → `forwardEvent` (harness-agnostic), inbound via `Session.respondToPermission`.
It never passes through `canUseTool`, the pre-approve lists, or Codex's `mapApprovalRequest`, so no
permission mode, allowlist, or auto-accept can suppress it — the handler is simply parked on a promise
until a human answers.

Non-negotiables when writing one (full walkthrough in `references/backend.md` →
**Human-in-the-loop confirmation**):

1. **`HostConfirmRegistry`** (`apps/desktop/src/main/session/host-confirm-registry.ts`), never a
   hand-rolled pending-promise Map. The renderer clears the dialog only on an `interaction_resolved`
   with the same requestId; the registry makes every terminal path (answer, cancel, timeout, turn
   abort) emit one by routing all settling through `take()`.
2. **Resolve in `Session.respondToPermission`, before `backend.respondToPermission`** — the early-return
   chain in `session.ts`. A backend-layer resolve (the old `video_gen_confirm` shape) only covers
   Claude and Codex; on ACP/OpenCode the user clicks Allow and the tool hangs to timeout.
3. **`allowAlwaysAllow: false`** for the delete/spend/spawn cases. "Always allow" re-opens exactly the
   bypass this tier exists to close. (`miniapp_call` sets it `true` on purpose: the grant is scoped to
   one app's tool and is the user opting that app in.)
4. **A distinct `requestKind`**, added to the union in `packages/shared/src/agent-types.ts` and to the
   `isSelfManagedConfirm` routing in `PermissionPrompt.tsx`, so the dialog shows the real subject
   (which sessions, which params) instead of a generic Allow/Deny.
5. **Pass `signal` + `abortError`** from `BuiltInSuperoneToolDeps` so interrupting the turn tears the
   dialog down instead of leaving it on screen.
6. **Confirm before effect.** Nothing irreversible or billable happens before the await resolves —
   build the preview from a dry run (`session_cleanup` resolves ids and titles first, then asks).
7. **Decline / cancel / timeout are neutral results**, not `isError`: return
   `status: 'rejected' | 'cancelled'` plus a hint telling the model what to do next — usually *do not
   retry on your own, wait for the user*. An error tempts a retry loop that re-prompts the human.

Codex has one extra trap: its elicitation carries **no tool arguments** — the tool identity is scraped
from the prompt text. Never move a tool's identity into args and expect pre-approval to keep working.

## Step 4 — Tool UI

Tool UI is for **humans observing the agent**, not for replaying the tool schema. Every SuperOne
tool that appears in chat needs a **designed** row so the user can tell at a glance what the call
did. The generic MCP row (plug icon + `server · tool name` + raw expand) is only a **fallback** for
unhandled / third-party tools — not the default product surface for `mcp__superone__*`.

Read `references/tool-ui.md` before writing a block. Principles and short version:

- **Observability** — the user must tell what the call did at a glance (usually from the collapsed
  row; sometimes from the result content itself).
- **Progressive disclosure** — header = key human info; complex args / full JSON / UUIDs live in
  expand (or nowhere). Exception: when the result *is* the UI, skip the header entirely.
- **Summary-first** — this app is built on short summaries (`getToolDisplay`, block-local derivation,
  `toolSummary` from main/ACP, agent fields like collab `summary`). Prefer basename / domain / one
  phrase over dumping parameters.
- **Base template** — `icon + label + summary + [Denied\|Error] + chevron` via `tool-row.tsx`
  (`CompactLabeledToolRow` / `ExpandableToolRow` / `ToolName`). Do not invent a new layout or
  write `Label: summary`. Running labels shimmer.
- **Label copy** — three Title Case forms, picked with `toolOutcomeLabel`:
  - streaming: sentence-case verb-ing + `…` (`Generating image…`)
  - done: **noun + past participle** (`Image Generated`, `Sessions Listed`, `Session Tagged`)
  - denied / error: **verb + noun** (`Generate Image`, `List Sessions`, `Tag Session`) —
    the badge already says Denied / Error, so never bake Failed / Denied into the title
  ZH: `正在…` / 名词+已+动词 / 动词+名词 — **all Chinese** (`列出会话`, not `列出 Session`).
  Full table + chrome in `references/tool-ui.md`.
- **Result-as-UI** — rare case (`widget_show` → `WidgetBlock`): args irrelevant to the user, rendered
  result fully represents the call → **no tool header**, only the content. Not the same as **hidden**
  (gallery owns image rows). Nested subagent still falls back to a Compact header stub.
- Outcomes for SuperOne tools: **`CompactToolRow`**, custom **`<Feature>ToolBlock`**, **result-as-UI**,
  or **hidden** (meta / other surface owns output). Generic MCP fallback is not a plan for built-ins.
- Hiding is a **contract, not a cleanup**: `isHiddenToolBlock` means something else renders the
  output (e.g. image gallery). Both sides must share the same predicate. Noise is fixed with a
  better summary, not with hide.
- Every block handles four states — `isStreaming`, `isError`, `isDenied`, complete — plus
  `allowExpand === false` when nested under a subagent.
- Storybook first under `SuperOne/MCP Tools` (include error + denied), wire into `ToolBlock`
  second. i18n both locales under a family namespace (streaming / action / done trio). Mobile
  may strip `input` — preserve a human summary; allowlist only if the phone truly needs full input.

## Step 5 — Guard the invariant with a test

Add assertions to `apps/desktop/src/main/mcp/superone-mcp-builtin-defs.test.ts`. This file exists
specifically because "registered on one surface, forgotten on the other" fails silently. Its existing
tests already cover generic drift (every name has a descriptor, every descriptor has a name, 700-char
budget, object schema). Add tool-specific assertions for the things that *would not be obviously
wrong* if they regressed:

- the follow-up tool named in a description (`expect(submit.description).toMatch(/media_video_status/)`)
- `required` field sets, and the deliberate *absence* of a cap
- desktop def ≡ host-action descriptor, if you added the tool to a family list like
  `SESSION_ARCHIVE_TOOL_NAMES`
- for a mandatory-confirm tool: the confirm is **unskippable** — with a decline/cancel/abort answer the handler
  performs no deletion / no submit and returns a neutral status. `session-archive-tools.test.ts`
  ("delete with user confirm", "dismisses host confirm when tool AbortSignal aborts") is the template

An assertion is worth writing when it encodes a decision someone could plausibly undo by accident.

## Step 6 — Verify

```bash
# From apps/desktop (vitest resolves the @ alias relative to this cwd — running from the repo
# root produces bogus "Failed to resolve" errors)
cd apps/desktop
bunx vitest run src/main/mcp/superone-mcp-builtin-defs.test.ts src/main/mcp/<family>-tools.test.ts
cd ../.. && bun run typecheck
bun run storybook   # if you added a block
```

Then exercise it live in at least **two harnesses** (Claude + one of Codex/ACP/OpenCode). The whole
point of the five-surface discipline is cross-harness parity, and only a real session proves it.

## Anti-patterns

| Smell | Why it hurts | Instead |
|---|---|---|
| New tool per variant (`config_read_general`, `config_read_browser`, …) | Tool list is a per-turn context tax | One tool, `domain` enum |
| Tool description that explains *how it works* | Model needs "when to call / what next", not internals | Boundaries + follow-up tool + `read_manual` pointer |
| One call returns the whole corpus / archive | Context blowout; agent cannot choose what it needs | List/search snippets → read/detail by id |
| Inline multi-KB body / HTML / screenshot bytes | One result burns the turn budget | Spill to file → path + preview; agent Reads if needed |
| TOON on nested / irregular objects | Often *larger* than JSON | Flatten to a table first, or keep JSON |
| Always-on essay in tool description | Taxes every turn of every session | ≤700 chars + `read_manual` for depth |
| `maxLength: 100000` on a text field | Advertises a target the model fills | Cap server-side, omit from schema |
| Handler `throw`s on user-facing failure | Surfaces as a harness error, not a readable result | `isError: true` + `[Error] …` |
| Destructive/paid tool relying on the harness permission prompt | Auto-approve list + `bypassPermissions` + Codex elicitation auto-accept each remove it | Executor-side `HostConfirmRegistry` host `permission_request` |
| Confirm modelled as an MCP elicitation for a built-in tool | Codex auto-accepts elicitations from `isBuiltInSuperoneTool` names | Host `permission_request` via `emitHostEvent` |
| Confirm resolved only in the backend layer | Claude/Codex work; ACP/OpenCode hang until timeout | Resolve in `Session.respondToPermission` first |
| `allowAlwaysAllow: true` on a delete/spend confirm | One click permanently disables the gate you just built | `false` — ask every time |
| Deleting / submitting first, confirming after | User is approving an accomplished fact | Dry-run preview → confirm → effect |
| Declined confirm returned as `isError` | Reads as a failure the model should retry → re-prompts the human | Neutral `status: 'rejected'` + "do not retry on your own" hint |
| Registering in `registerSuperoneTools` only | Silently absent in Codex/ACP | Both surfaces + the drift test |
| Custom ToolBlock covering only the success path | Streaming/denied/error rows render blank | Four states + `allowExpand` fallback |
| Shipping SuperOne tool with only generic MCP fallback | User sees plumbing, not what the call did | Designed row: summary + `tool-row` primitives |
| Header dumps raw args / full paths / UUIDs | Collapsed row unreadable; fails progressive disclosure | One human summary; detail on expand |
| `Label: summary` colon in the header | Breaks name + space + muted summary | `ToolSummary` as a sibling span |
| Header on a pure content tool (e.g. widget) when result already is the UI | Double narrates; chrome adds no observability | Result-as-UI: content only; Compact stub only when nested |
| Success past tense on fail (`Image Generated` + Error) | Claims the work finished | `Generate Image` + Error badge |
| Failed baked into the title (`Image Generation Failed`) | Duplicates the Error badge | verb + noun title; badge carries outcome |
| Hand-rolled denied/error colors (`text-destructive`, “Denied” in summary) | Diverges from Bash / Read | `ToolStatusIcon` + `ToolStatusBadge` + `toolRowSurfaceClass` |
| Running label without shimmer | Looks idle while the tool is in flight | `ToolName` / `animate-shimmer` |
| Title Case streaming or Title Case muted summary | Looks finished while running / fights the label | Streaming sentence+`…`; summary stays soft fragments |
| Hardcoded EN strings in a ToolBlock | ZH UI falls back; copy drifts | `t('chat.toolBlock.<family>.*')` both locales |
| Hiding a tool row "to reduce noise" | Output disappears entirely if nothing else renders it | Better summary / Compact row; hide only when owned elsewhere |
| Runtime-varying tool list | Codex snapshots `tools/list` once | Fixed dispatcher tool with a `name` parameter |

## Reference files

- `references/backend.md` — agent progressive disclosure, token-saving (TOON, spill-to-file),
  registration walkthrough, human-in-the-loop confirmation (destructive / paid tools),
  own-descriptor path, manuals.
- `references/tool-ui.md` — Tool UI philosophy, label grammar (streaming / done / denied-error),
  status chrome, shared `tool-row` primitives, summary, base template, result-as-UI, routing,
  hide contract, Storybook (`SuperOne/MCP Tools`) / i18n / mobile.
