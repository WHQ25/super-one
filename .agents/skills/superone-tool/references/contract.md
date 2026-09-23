# Tool contract and permissions

## The five surfaces

| # | Surface | Where | What breaks if you skip it |
|---|---|---|---|
| 1 | Host-owned admission set | `packages/shared/src/superone-host-owned-tools.ts` → `STATIC_HOST_OWNED_SUPERONE_QUALIFIED_TOOL_NAMES` | Auto-review may prompt for or refuse the tool before its executor runs |
| 2 | JSON-Schema descriptor | `apps/desktop/src/main/mcp/superone-mcp-builtin-defs.ts` → `BUILT_IN_SUPERONE_TOOL_DEFS` | Invisible to Codex / ACP / OpenCode (stdio bridge), works fine in Claude |
| 3 | Zod registration + execute switch | `apps/desktop/src/main/mcp/superone-mcp-builtins.ts` | Invisible to Claude (in-process SDK server) / `Unknown SuperOne MCP tool` at call time |
| 4 | Remote-node descriptor | `packages/shared/src/environment/host-action-*-descriptors.ts` | Missing when the session runs on a remote node (CLI) |
| 5 | Chat Tool UI | `apps/desktop/src/renderer/src/components/chat/` | Unhandled SuperOne tools fall back to a generic MCP row (plumbing, not a design). User cannot tell what the call did |

`apps/desktop/src/main/mcp/superone-mcp-tool-surface.ts` needs **no** edit for a built-in: it spreads
`BUILT_IN_SUPERONE_TOOL_DEFS` and dispatches by `BUILT_IN_SUPERONE_TOOL_NAMES`. Only tools that opt
out of the built-in machinery (browser, widget, computer-use, mobile share) carry their own
descriptors and need an explicit branch there.

Read [backend.md](backend.md) for the file-by-file code, in the order to write it.

### Wire names

The bare name is the source of truth; Claude, Codex, and Grok each wrap it differently and
chat only accepts `mcp__superone__{bare}`. The per-harness table and the symptom of each
mismatch live in [backend.md → Wire names](backend.md#wire-names-on-claude--codex--grok);
this skill owns the descriptor, handler, executor confirm, and ToolBlock, while injection of
the `superone` server is `superone-harness` → **Host SuperOne tools**.

`session_rename`, `session_tag`, and the collaboration mailbox (`session_collab_send`,
`session_collab_retrieve`) are **main-thread only** (`MAIN_THREAD_ONLY_SUPERONE_TOOL_NAMES`). A
child / subagent must get a direct denial, even when it inherited the parent's MCP connection. Do
not "fix" that by pre-allowing the child. A tool whose executor authorizes by the calling session
(rather than by a value the agent holds) belongs on this list.

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

Harness-side injection and Layer A recipes (Claude `allowedTools`, Codex per-tool `approval_mode`,
Grok preapprove) live in `superone-harness`. Do not fork a fourth admission shape when adding a
tool — add the **bare name** to the shared set and the three harnesses pick it up.

Write tests for the chosen policy before the handler: admission-set membership (or deliberate
absence), feature-off behavior, and no-effect decline/cancel/abort cases for executor confirmation.

### Name

`<domain>_<verb>[_<object>]`, snake_case: `session_list`, `media_generate_image`, `config_apply`,
`miniapp_dev_setup`. The domain prefix is doing real work — it groups the tool in an alphabetical
tool list and lets the permission/UI layers match by prefix. Never invent a second domain word for a
capability that already has one.

### Description — task selection and next steps

State the capability and when to use it. Add exclusions only to prevent a likely
confusion with a sibling tool. Include the follow-up tool when a call returns a
handle rather than a finished result. Keep descriptions within the existing
700-character ceiling; it is a limit, not a target.

Shared text lives in `packages/shared/src/superone-tool-descriptions.ts`, imported
by desktop definitions and remote descriptor families. Keep argument guidance on
the relevant schema field and long workflows in `read_manual` topics. Field
schemas may also load eagerly, so moving prose there does not make it free.

Read manuals when the task needs their non-obvious contract. Do not require a
fresh catalog read for an id already known, or confirmation of routine defaults
already covered by the user's request. Preserve executor-side confirmation and
cancellation behavior; a prompt rewrite cannot relax those checks.

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
- **Encoding / spill** — see **Saving tokens** in [backend.md](backend.md): TOON for flat list tables;
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
`MAIN_THREAD_ONLY_SUPERONE_TOOL_NAMES` stay in the static
admission set so the *parent* can call them without a harness prompt, and are denied in each
harness's child-session path before any auto-allow.

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

Non-negotiables when writing one (full walkthrough in [backend.md](backend.md) →
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

