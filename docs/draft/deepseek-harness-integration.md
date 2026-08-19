# DeepSeek Harness (dsh) Integration — Route D: In-Process Cordis Embedding (Draft)

Status: **in progress** — Route D executing. P0 (contract) + P1 (runtime/backend/credentials) + P2 (live model catalog → renderer resources, session defaults) landed; P3 partial (pickers, icon, permission subset, context gauge); P4 started — native tool plane (fs/shell/search/todo + permission gate, host-plane since P4e) and SuperOne's own tools as native dsh plugins landed; third-party MCP, resume, session fork and foreground subagents (spawn + fork, rendered as a Task block) landed; compaction, the `tool-cordis` opt-in and the sandbox + permission presets landed; background/continuable children still pending
Last updated: 2026-08-19

> Execution note (P2, resolved in P4h): `dsh-permission-presets` hard-requires a mounted *confining* bash executor (`ctx.shell.sandboxMode`) and `ctx.approval` — its constructor throws otherwise. That is why the D5 preset vocabulary had to wait for the sandbox tier; both landed together in §20.
Spike: [`docs/draft/deepseek-harness-spike.mjs`](./deepseek-harness-spike.mjs) (reproducible; see Appendix)
Related: `.agents/skills/superone-harness/` (new-harness roadmap, event contract, experiences matrix), `docs/design/cursor-sdk-harness.md` (breadth reference: 152 files / 7 commits)

---

## 1. Decision summary

Integrate DeepSeek Harness (`dsh`, `@deepseek-ai/dsh-*`) as a new SuperOne harness by **embedding its Cordis plugin tree in-process** and writing SuperOne-owned Cordis plugins that bridge dsh's seams to SuperOne's `AgentEvent` contract, HITL surfaces, and tool plane.

Identity boundary: SuperOne's canonical `HarnessId`, `NodeHarnessId`, AgentEvent `providerId`, and
base SessionProvider prefix are all `dsh` (`dsh-base`). `DeepSeek` / `deepseek` remain the product
name, brand key, API-provider id, i18n/label keys, and package/file names. The harness has never
shipped, so there is deliberately **no back-compat path** for the pre-rename `deepseek` id: no DB
migration, no settings alias — a dev database written before the rename must be re-seeded.

This is different from every existing harness (Claude = black-box SDK, Codex = spawned binary, ACP = wire protocol, Cursor = SDK + local store): dsh is a **white-box plugin tree** — MIT-licensed, all-TypeScript, published on npm — so the bridge logic lives *inside* the engine as first-class plugins instead of adapting an event stream at the boundary. This is also the only route that delivers cancel + HITL approval today:

| Route | Cancel | HITL approval | Streaming | Verdict |
|---|---|---|---|---|
| A. ACP server (`@deepseek-ai/dsh-acp`) | ✅ | one-shot only | ❌ committed messages only | automation-grade; rejected |
| B. SDK subprocess (`@deepseek-ai/dsh-sdk-client`) | ❌ no wire method | ❌ unimplemented on wire | ✅ | hard gaps; rejected for now |
| C. Web Client protocol (Connection `/api` + Typert RPC) | ✅ | ✅ | ✅ | full fidelity but generated-artifact coupling; fallback option |
| **D. In-process embedding (this plan)** | ✅ verified | ✅ verified | ✅ verified | **chosen** |

dsh is in **developer preview** (`0.1.0-rc.7` at time of writing) with breaking changes promised. §11 owns the version strategy; the short version is: exact-pin the whole family, keep the spike as a smoke test, absorb breakage on explicit upgrades only.

---

## 2. What dsh is (one paragraph)

dsh is built on [Cordis](https://github.com/cordiverse/cordis): every part of the product — model adapter, tool registry, session log, agent loop — is a plugin contributing services (`ctx.llm`, `ctx.tools`, `ctx.sessions`, `ctx.agents`, `ctx.approval`, …), typed events, and reversible registrations to a shared context. The session log is an append-only `SessionEvent` stream (`turn/*`, `step/*`, `assistant/chunk`, `tool/call`, `tool/result`, `todo/write`, …) from which model history is *derived*; "model-visible means logged" is a runtime invariant. Capability seams (fs, subprocess, shell, sandbox, subagent, approval, questions) are swappable provider triangles. Plugins mount and unmount at runtime with effects unwinding cleanly.

---

## 3. Verified facts (experiments, 2026-08-18)

All experiments ran against the **published npm packages** `@deepseek-ai/*@0.1.0-rc.7` (not the repo checkout), which is exactly how SuperOne will consume them. Full script: `deepseek-harness-spike.mjs`; runs green under **both Node 24 and bun 1.3.9**.

| # | Experiment | Result |
|---|---|---|
| E1 | `bun add @deepseek-ai/dsh` | ✅ 524 packages, 195 `@deepseek-ai/*`, complete `lib/` + `.d.ts` + `src/` in every package. No sqlite/native deps in the core path. 4 postinstalls blocked by default; only `dsh-subprocess-local` (spawn helper) and `koffi` need trusting, and only when the bash/PTY executors are mounted. |
| E2 | In-process boot: `new Context()` + 8 `ctx.plugin(...)` calls (Timer, LlmRuntime, SessionStore, SystemPrompt, ToolRuntime, AgentRegistry, ApprovalService, AgentLoop) + a mock `LlmAdapter` on route `mock` | ✅ Bridge plugin activates via `inject: ['agents','llm','tools','sessions']`; `agents.create()` → `followup()` produces the full durable stream: `turn/start → step/start → user/message → request/header → request/context → assistant/chunk×N → assistant/message(+usage) → step/end → turn/end {kind:'completed'}` |
| E3 | Custom tool via `ctx.tools.register(...)` + scripted tool-call | ✅ `tool/call` → pipeline → `tool/result` → automatic second step → final text, one turn. Tool schemas assembled into `request/header.tools` automatically. |
| E4 | HITL: `tools/pre-execute` waterfall returns `{kind:'ask'}`, `approval/request` waterfall answered in-process after a delay | ✅ Approval intercepts the call, an async answerer returning `'allowed-once'` resumes execution, and dsh logs `approval/asked` / `approval/decided` audit events into the session log for free. |
| E5a | Mid-turn cancel: `agent.cancel({kind:'user'})` during streaming | ✅ Stream stops, `turn/end {kind:'aborted', reason:{kind:'user'}}`, agent returns to `idle`, next turn works normally. |
| E5b | Runtime hot mount/unmount: `ctx.plugin({...registers tool 'extra'})` then `fiber.dispose()` | ✅ Model-visible tool list goes `[extra, ping]` → `[ping]` across turns. Reversible-effects model confirmed end-to-end. |

Additional verified facts from source/docs review:

- **`llm-pi-ai`** is a generic multi-provider adapter (config-keyed provider profiles; OpenAI-compatible gateways are configuration, not code).
- **`mcp-client`** registers external MCP server tools on `ctx.tools` — SuperOne's `mcp__superone__*` surface plugs in without new code.
- **Subagent providers** include `subagent-claude-code` and `subagent-codex` — dsh can delegate to our other harnesses as subagents.
- dsh anticipates Electron embedding: the connection layer has an in-process carrier, and `dsh-host-webserver` documents "Electron loads dist over `file://` and carries fetch over an IPC bridge".
- `ctx.sessions.fork(source, boundary?, childSessionId?)` and `agents.resume({resumeSessionId})` exist; persistence is `dsh-session-persistence-jsonl` (zstd-compressed JSONL, seed-replay on resume).

### Footguns found by the spike (encode these in the backend)

1. **`resolveModel()` is strictly validated** — must return `{provider, id, name}` echoing the exact route/id, else `INVALID_MODEL_INFO` fails the turn.
2. **Send-after-turn is latched** — a `followup()` submitted between `turn/end` and the idle transition can park in the inbox without opening a turn. Await `agent.whenIdle()` before treating the agent as ready, and treat parked input as "queued message" UI state.
3. **Family versions are lockstep** — all `@deepseek-ai/dsh-*` must be the same exact version; never mix.
4. **The default system prompt announces dsh identity** — `SystemPrompt` config (`includeHarnessIdentity`, `persona`) is where SuperOne branding/persona goes.
5. **`agent/status` payload is `{agent, status}`** (single object), and the agent id is `agent.id` (= `SessionId`).

---

## 4. Architecture overview

```mermaid
flowchart LR
  subgraph renderer [Renderer]
    UI[Chat UI / stores<br/>existing AgentEvent consumers]
    PP[Permission popover<br/>question card]
  end
  subgraph main [Electron main process]
    subgraph backend [DeepseekBackend implements SessionBackend]
      MAP[AgentEvent mapper]
    end
    subgraph tree [dsh Cordis tree - one shared Context]
      SPINE[spine: llm / sessions / tools /<br/>systemPrompt / agents / agent-loop]
      BRIDGE[superone-bridge plugin<br/>session/event + agent/* taps<br/>approval + question answerers]
      ADAPT[llm-deepseek + llm-pi-ai<br/>credentials from SuperOne store]
      MCP[mcp-client → mcp__superone__* tools]
      PERSIST[session-persistence-jsonl<br/>rooted in SuperOne data dir]
    end
  end
  UI <-->|IPC AgentEvent| MAP
  MAP <--> BRIDGE
  PP <-->|permission_request round trip| BRIDGE
  BRIDGE --- SPINE
  ADAPT --- SPINE
  MCP --- SPINE
  PERSIST --- SPINE
```

One dsh `Context` per app lifetime hosts N agents (one per SuperOne dsh session); each `agents.create()` gets its own scoped `agent.ctx`, `cwd`, model route, and inbox. The backend never reaches into loop internals — everything flows through documented seams, exactly like the spike.

---

## 5. Design decisions

### D1 — Process model: Electron main, in-process (like Claude), utilityProcess deferred

The Claude harness already runs an agent engine inside main; dsh's minimal spine adds no native modules and no server. Start in-process for parity and debuggability. Revisit `utilityProcess` isolation only if profiling shows loop work competing with IPC/UI duties, or when the bash/PTY executors (which spawn real processes) land. The composition is carrier-agnostic, so the move is mechanical later: the bridge plugin stays identical; only the AgentEvent transport changes from function call to MessagePort.

### D2 — One shared Context, one agent per SuperOne session

The ACP bridge and Web host both run many sessions on one tree; per-agent isolation comes from scoped contexts (`agent.ctx`) and scope-filtered event dispatch (`tools/pre-execute` etc. are Scoped). SuperOne does the same: a lazily-booted singleton tree in `@superone/deepseek`, `agents.create({sessionId, meta:{cwd}, agentOptions:{provider, model, maxTokens}})` per session, `handle.dispose()` on close. Per-session tool/capability differences use `CreateAgentOptions.setup` (composes the agent's scoped world before publication).

### D3 — Composition: manual spine, no Loader/YAML/profiles

`dsh`'s CLI boots from profile YAML through the Loader; `agent-spine-demo` proves the same tree composes with plain `ctx.plugin(...)` calls. SuperOne owns configuration already (settings store, credentials, per-session options), so we compose programmatically and skip: Loader, `$DSH_HOME` profiles, `settings-file`, `credentials-local`, telemetry, webserver, the entire `client/*` and `host/*` planes. Initial plugin set (verified minimal + product needs):

| Plugin | Why |
|---|---|
| `cordis-plugin-timer`, `dsh-llm`, `dsh-session`, `dsh-system-prompt`, `dsh-tools`, `dsh-agent`, `dsh-agent-loop` | the verified minimal spine |
| `dsh-user-approval` (policy `ask`), `dsh-user-questions` | HITL seams the bridge answers |
| `dsh-permission-presets` | semantic source for the displayed permission vocabulary (Q2 decision) |
| `dsh-llm-deepseek`, `dsh-llm-pi-ai`, `dsh-llm-retry`, `dsh-token-meter` | model routes + retry + accounting |
| `dsh-session-persistence-jsonl`, `dsh-session-checkpoint-policy` | durability + resume |
| `dsh-compaction-basic`, `dsh-session-projection` | context compaction + durable subagent identity |
| `dsh-tool-todo` | `todo/write` → TODO panel |
| `dsh-subprocess-local`, `dsh-bash-local`, `dsh-shell-env`, `dsh-tool-bash` | bash execution (needs postinstall trust; see E1) |
| `dsh-fs-local`, `dsh-fs-observation-policy`, `dsh-tool-fs` | read/write/edit tools |
| `dsh-subagent` + `dsh-subagent-spawn-in-process` + `dsh-tool-subagent` | subagents (P4) |
| `dsh-mcp-client` | mount `mcp__superone__*` (P4) |
| `dsh-invariants` + per-package invariant companions | keep on in dev builds; they catch bridge mistakes loudly |

Skills, goals, workflow, jobs, e2b, LSP, terminal: deferred until a product decision wants them — each is one `ctx.plugin` line away.

### D4 — The bridge is a Cordis plugin; the backend is thin

`superone-bridge` (inside `packages/deepseek`) is a dsh plugin with `inject: ['agents','llm','tools','sessions']`. It owns: session/event tap → AgentEvent mapping (§6), `approval/request` + question answering (D5), agent registry bookkeeping. `DeepseekBackend implements SessionBackend` holds the per-session façade (send/interrupt/setModel/…) and calls into the bridge. This keeps all dsh vocabulary in one file pair and the backend looking like every other backend to the rest of SuperOne.

### D5 — HITL mapping

- `approval/request` (waterfall, carries `agent`, `toolName`, `callId`, `reason`, abort `signal`) → emit `permission_request` with the already-streamed tool block (`callId` matches the `tool/call` event we already mapped). User's answer resolves the waterfall: allow → `'allowed-once'`, deny → `'rejected'`; a withdrawn request (signal abort) clears the popover. dsh's own `approval/asked`/`approval/decided` audit events are mapped to nothing (UI already reflects the round trip) but keep sessions replayable.
- Which calls ask: dsh's approval policy (`'ask'` default) + our own `tools/pre-execute` policy listener. **Decided 2026-08-18: the displayed mode vocabulary is dsh's own permission presets** — mount `dsh-permission-presets` as the semantic source and register its preset names in the mode-list module, following the Codex precedent (shared `PermissionMode` stays the carrier type across the ~40 store/wire surfaces; the popover, status bar, and mode list show dsh preset names mapped onto it). SuperOne's permission popover remains the presentation; the seam is the integration point.
- `ctx.userQuestions` provider → `ask_user_question` AgentEvent; same round-trip pattern.

### D6 — Tool plane: everything is a plugin (revised 2026-08-19)

**Landed (P4a) — native tools. Relocated to the host plane in P4e; see §17.** `packages/deepseek/src/tool-plane.ts` mounts `subprocess-local` + `fs-local` + `bash-local` + `shell-env` and the `read/write/edit`, `glob/grep`, `bash`, `todo_write` tools. The first cut put them inside `agents.create({setup})`, one isolated realm per session; delegation made that unrepresentable and they now sit in the tree's global layer, where dsh's own rosterless deployments keep them. Per-session correctness moved with them and did not weaken: dsh resolves the workspace at the *tool* boundary (`tool-fs` passes `exec.agent.session.header.cwd` into `ctx.fs.resolve()`, `tool-bash` defaults `workdir` the same way), so `config.cwd` is only the fallback for a non-agent caller. The "keeps each session rooted in its own cwd" test passed unchanged across the move, which is the evidence.

**Permission gate.** dsh's own `ctx.approval` only fires for *sandbox escalation*, and with an unconfined `bash-local` that never happens — so mounting tools without a gate would run `write`/`bash` with no prompt at all. A SuperOne-owned `tools/pre-execute` listener allows read-only tools (`read`, `read_image`, `glob`, `grep`, `todo_write`) and asks for everything else. It asks through the backend's own answerer rather than returning dsh's `{kind:'ask'}`, because `approval.request` carries only a tool name while the popover renders the call — the bash command, the file being written. `bypassPermissions` short-circuits in the backend, so both paths share one mode check. The listener is host-plane too (P4e): a gate on the parent's agent scope never sees a delegated child's calls.

**Naming.** dsh's argument shapes already match Claude's (`file_path`, `command`, `old_string`…), so the event mapper renames `read/write/edit/bash/glob/grep/todo_write` to the canonical `Read/Write/Edit/Bash/Glob/Grep/TodoWrite` and the existing renderers (Bash terminal view, edit diff, todo panel) light up unchanged. The permission popover uses the same canonical name.

**Landed (P4b) — SuperOne's own tools are native dsh tools.** Superseded the original "MCP first" plan after one iteration of it. `packages/deepseek/src/tool-surface.ts` registers SuperOne's built-ins directly on the agent's scope, executing in-process through the same `listSuperoneMcpTools` / `executeSuperoneMcpTool` pair the MCP server calls. dsh's organising principle is that everything is a plugin and its tool registry resolves per agent scope, so the aligned integration is a plugin — not a client of our own server.

The MCP bridge that preceded it (an MCP SDK client per session over `getSuperoneMcpHttpConfig(sessionId)`) worked, but it paid a transport, a session token, a reconnect policy and a `tools/list_changed` subscription to reach tools living in the same process, and it did not implement that last one — a mini-app registered mid-session stayed invisible until restart. Native registration re-syncs off `addToolsChangedListener`, so Computer-Use toggles, mini-app registration and mobile-share availability all take effect on the next request. It also drops the `@modelcontextprotocol/sdk` dependency from `@superone/deepseek`.

Names stay qualified — `mcp__superone__<bare>` — even though nothing MCP is involved for dsh any more. That string is SuperOne's canonical tool identity: host-owned admission, hidden tool rows, mobile event stripping and mini-app dispatch all match on it, and Claude/Codex/ACP advertise the same names. The bare name is what reaches the executor.

Two containment rules survive from the bridge: a broken surface is caught inside `mountToolPlane` (a `setup` rejection rolls the agent scope back, so the session would never be published), and a descriptor dsh rejects skips one tool instead of the whole surface. Each tool declares the canonical `{content, structuredContent?}` output envelope because dsh validates `output.schema` at `register()`.

**Layer A admission.** `isStaticHostOwnedSuperoneToolQualified()` short-circuits the permission gate for SuperOne's own tools, so their executor (which runs the real product confirmation) owns the authorization. Dynamic mini-app / third-party tools sharing the prefix are deliberately not matched, and `computer_*` still prompts — the feature-gated set is not plumbed into the gate yet.

**Landed (P4c) — third-party MCP servers, from dsh's own config file.** `@deepseek-ai/dsh-mcp-client` is mounted unmodified, once per distinct server config, in the tree's global layer.

The decisive question was *whose config file*, and the answer follows SuperOne's product principle: SuperOne **extends** a harness rather than centralizing it, so each harness keeps its servers in its own file — Codex in `~/.codex/config.toml`, dsh in its profile patch layer. (SuperOne's cross-harness MCP list exists so a user can *re-apply* a server they used elsewhere; it is a catalog for reconfiguration, not one shared runtime config.) An earlier cut of this had dsh reading the Claude-shaped `~/.claude.json` / `.mcp.json` family that Cursor, ACP and OpenCode share — wrong for exactly that reason.

Verified location (`~/.dsh` on a machine that had run dsh):

```
~/.dsh/
  settings.yaml                        # runtime settings — not plugins
  .credentials.yaml                    # DEEPSEEK_API_KEY
  profiles/
    node_modules/                      # installed plugin packages (dsh-mcp-client included)
    web/
      package.json                     # dsh.profile.bundles
      cordis.yml                       # "Edit cordis.patch.yml, not this file."
      cordis.patch.yml                 # ← MCP servers live here, as loader entries
```

`packages/runtime/src/fs/mcp-config-dsh.ts` reads and writes that patch layer through the `yaml` document API, touching only entries whose `name` is `@deepseek-ai/dsh-mcp-client`; every other row, its comments and dsh's `!!js` expressions round-trip untouched (covered by tests). `listMcpConfigs(provider, cwd)` gains a `dsh` branch beside Claude's and Codex's, and `ResourceProvider` widens to include `dsh` — for MCP only, since dsh has no skills surface there.

**Placement follows dsh, not SuperOne.** dsh composes per deployment: one Host process serves many workspaces, its servers are composition entries, and `serverName` is a process-wide reservation by design. So there is no project scope to model — every server mounts once in the global layer and every session sees the same set, which is exactly what that one file says. `DeepseekMcpServers.sync()` diffs by connection-tuple identity, so an edited endpoint re-mounts and a removed server goes away.

Not covered: the desktop settings page still has no dsh MCP CRUD channel (the runtime facade supports `provider: 'dsh'`, so the node/CLI path is complete); SSE servers are dropped (`dsh-mcp-client` speaks stdio and Streamable HTTP); `getMcpServerStatus()` still returns `[]`.

**Open, related:** `~/.dsh/.credentials.yaml` holds the user's `DEEPSEEK_API_KEY`. D7 currently ignores it and serves credentials from SuperOne's own store. Under the same "extend the harness" principle that decided this section, that deserves a second look.

### D7 — Models & credentials stay SuperOne-owned

Do not mount `dsh-settings-file` / `dsh-credentials-local` (they own `$DSH_HOME` files and env resolution). Register adapters programmatically: `dsh-llm-deepseek` config from the SuperOne credential store (DeepSeek official), `dsh-llm-pi-ai` profiles generated from SuperOne's existing provider/credential bindings (OpenAI-compatible endpoints are config rows). Model picker reads `ctx.llm.listProviders()` / `listModels()` — live, adapter-owned, no static catalog to maintain; classification can reuse the local models.dev mirror (`buildCatalogTaskIndex`) like custom providers do.
`request/context` events carry `contextWindow` per route — feed the context gauge from there instead of a hardcoded table.

### D8 — Persistence, resume, fork

- Mount `dsh-session-persistence-jsonl` with `root` under SuperOne's per-project data dir. dsh owns durability of its own log (crash-safe, seq-contiguous); SuperOne's SQLite keeps rendering-oriented persistence exactly as for other harnesses. Dual-write is redundant by design — the JSONL is the *provider-side* thread, ours is the UI cache — same split as Claude's `.jsonl` vs our DB.
- `provider_session_id` = the dsh `SessionId` we mint at `agents.create`.

**Landed (P4d) — cold resume.** `agents.resume({resumeSessionId})` was already wired; what needed pinning is *why it does not duplicate the transcript*. dsh seeds a resumed session through its **constructor**, and constructor seeds never publish on the `session/event` firehose (`Session.firstLiveSeq` documents exactly this), so our mapper only ever sees live events. A test boots a second tree over the same JSONL root and asserts both halves at once: the model sees the earlier turn, SuperOne's event stream does not.

**Landed (P4d) — fork.** Copies the log prefix at the **persistence layer** (`load` → filter by seq → `create` + `append`), not through `ctx.sessions.fork`. Two facts rule that API out for our shape:
- it only accepts a **live** source (`SESSION_NOT_LIVE`), while the usual fork is cold — the user forks a session nobody is running;
- it *publishes* the child, and a published session cannot then be resumed in the same process (`cannot prepare session while it is live`), which is exactly what the desktop does next.

The prefix write keeps nothing live, so the child starts through the ordinary resume path — the same shape as Claude's fork. Lineage (`parentSession`, `seedLength`) is recorded in the child header; `createdAt` is epoch ms, not an ISO string (the persistence coordinator validates it).

**Fork boundary.** dsh forks at an inclusive event seq, so the mapper stamps each `message_complete` with the seq that closed its step, carried on the shared `MessageMetadata.forkAnchorId` seam the other harnesses already use for their native ids. `forkDeepseekTranscript` resolves SuperOne's `forkFromMessageId` to that seq, walking back to the previous completed message when the fork point is a user message (which has no seq of its own). Cutting at a step boundary can leave the turn open at the tail; dsh's cold-load recovery closes it, which is the same path an interrupted session takes.

### D9 — Runtime plugin hot-swap is a product surface, later

E5b proves mount/unmount works live. The eventual "SuperOne features as runtime-loadable plugins" product builds on this — but it is explicitly **out of scope** for the harness integration phases below. The integration only has to not preclude it, which D2/D4 guarantee (everything is already a plugin).

**Exception (decided 2026-08-18): `tool-cordis` ships as a user-facing opt-in setting** (default off), following the Browser-CDP/Liquid-Glass opt-in pattern: an `AppSettings` flag gates one `ctx.plugin(toolCordis)` mount at tree boot, with the setting description warning that model-mounted plugins are experimental and affect every dsh session in the process. Lands in P4.

---

## 6. Event mapping: dsh `session/event` + `agent/*` → `AgentEvent`

The mapper lives in `packages/deepseek/src/event-map.ts`, table-driven, tested against recorded spike logs. Ordering guarantees come free: the session log is seq-contiguous and the reducer's happy order (`message_start` → deltas → `message_complete`) matches `step/start` → chunks → `step/end`.

| dsh event | AgentEvent | Notes |
|---|---|---|
| (backend start) | `session_init` | once, from backend, not from dsh |
| `turn/start` | — (bookkeeping) | marks turn scope; drive idle derivation |
| `step/start` | `message_start` | one assistant message per step |
| `assistant/chunk {type:'text-delta'}` | `content_delta` (text) | batch via shared `agent-event-batcher` + `applyContentDelta` |
| `assistant/chunk {type:'reasoning-delta'}` | `content_delta` (thinking) | |
| `assistant/chunk {type:'tool-call-delta'}` | `content_delta` (tool_use) + `tool_input_delta` | raw JSON string deltas; `mergeToolUseInputJson` handles sparseness |
| `assistant/chunk {type:'block-end'}` | finalize the block | authoritative assembled block |
| `assistant/message {usage}` | `message_usage` | disjoint counts: billed input = input + cacheRead + cacheWrite |
| `tool/call` | (tool_use block already streamed) | correlate by `callId` |
| `tool/result {message, error?, meta?}` | `content_delta` (tool_result) | `meta` is tool-private presentation payload — keep for custom ToolBlocks |
| `step/end` | `message_complete` | |
| `turn/end {kind:'completed'}` | `status_change` (idle candidate) | idle = `turn/end` + `agent/status idle` (both observed; see footgun 2) |
| `turn/end {kind:'aborted'}` | `message_interrupted` | maps user cancel |
| `turn/end {kind:'error'}` | `message_error` | error carried in reason |
| `todo/write` | `todos_updated` | whole-list snapshot, replace |
| `request/header` | (init-ish metadata) | system prompt + tool schemas; useful for context inspector |
| `request/context` | context gauge input | `contextWindow` per resolved route |
| `compaction/start` / `summary` / `end` | `compact_boundary` / `status_indicator` | from `compaction-basic` |
| `agent/inbox/spliced` (insert, no turn) | queued-message chip state | parked input = queued |
| `agent/inbox/claimed` | `queued_message_consumed` | |
| `agent/status {status}` | `status_change` | |
| `agent/error` | `message_error` | non-turn-scoped failures |
| `approval/request` (waterfall) | `permission_request` | round trip resolves the waterfall (D5) |
| user-questions seam | `ask_user_question` | |
| `subagent.started` lineage / `session-projection` | `task_started` + `parentToolUseId` | P4; recursive tree per existing subagent rendering rules |
| session title provider (`ctx.sessionTitle`) | `session_title_changed` | we register SuperOne's titler as the sole provider |
| `llm/adapters-updated` | model picker refresh | registry notification, re-read lists |
| `hook/invoked` / `hook/result` (if hooks mounted) | `hook_started` / `hook_complete` | deferred |

---

## 7. `SessionBackend` sketch

Required members all have direct dsh counterparts (verified in spike): `send` → `agent.followup(createUserMessage(...))` after `whenIdle` gating / else queued; `interrupt` → `agent.cancel({kind:'user'})`; model/permission setters → `agentOptions` are create-time, but model *can* change per-request via route config — treat model change as in-place (no rebuild), permission-mode change as in-place (policy listener reads current mode).

Optional members — honest first-cut:

| Member | P1 stance |
|---|---|
| `setTitle` | ✅ implement (we own the `ctx.sessionTitle` provider) |
| `getPendingInteractions` | ✅ implement — replay unanswered `approval/request`s (bridge holds open waterfalls) |
| `stopTask` | ❌ omit until subagents (P4) |
| `injectTaskNotification` | ✅ implement via `agent.inject()` (mid-turn context; lands in next admitted request) |
| `getRateLimits` | ❌ omit (no provider signal yet) |
| `requestSessionRecap` | ❌ omit |

## 8. Capability flags (initial, honest)

`supportsTodos: true` (E3 path + `tool-todo`), `supportsStreamingToolInput: true` (E2), `supportsCompact: true` once `compaction-basic` mounted, `supportsSubagents: false` until P4, sandbox control: `false` in `sandboxHarness.ts` initially (dsh sandbox seam exists but only Linux landlock is native today — folding SuperOne's macOS sandbox in is its own project), effort selector: expose only if the configured adapter reports `reasoning.efforts` for the selected model (dynamic, like the mapped-provider rule).

---

## 9. Phase roadmap

Follow `.agents/skills/superone-harness/references/new-harness.md` (P0→P5), specialized:

**P0 — Contract layer** (compiler-driven): add `dsh` to `HarnessResourcesMap`; fix every red `Record<HarnessId,…>`: `HARNESS_CAPABILITIES` (§8 values), `HARNESS_DEFAULT_BRAND_HUE`/`HARNESS_DEFAULT_TOKENS`, `HarnessHandlerMap`, store maps, `BrandColorPopover` label, `createHarnessRunner` switch. Add the `dsh-base` entry to the exhaustive shared SessionProvider catalog and use it for desktop + runtime/CLI DB seeds. Add `NODE_HARNESS_DEFINITIONS` entry (visibility fails closed without it). i18n strings.
*Accept:* typecheck green; harness visible-but-inert in pickers.

**P1 — Runtime layer**: new workspace `packages/deepseek` (`@superone/deepseek`): pinned `@deepseek-ai/*` deps, tree boot (D3), bridge plugin (D4), event mapper (§6), `DeepseekBackend` (§7) registered in main. Mock-adapter unit tests for the mapper (table-driven over spike-recorded logs); real `llm-deepseek` behind a credential.
*Accept:* full turn streams in chat UI; stop button works; errors surface.

**P2 — State layer**: chat-store `deepseek-handler`, `session-lifecycle` defaults (default model route/permission), routing switches.
*Accept:* store-routing tests green (`chat-store/harness/*-handler.test.ts` pattern).

**P3 — Presentation**: model picker from live `ctx.llm` lists (D7); permission popover + `StatusBarPermission` + mode list (D5); icon + brand (all three registries: `resolveSessionIcon`, brandKey variant, hue/tokens); context gauge from `request/context`; TODO panel.
*Accept:* manual chat-bar walk left→right, every control live or intentionally absent.

**P4 — Parity features**: HITL approval + questions round trip (D5) if not landed in P1; MCP tool mount (D6); resume (`provider_session_id` persistence + `agents.resume`); fork (D8); subagents (`spawn-in-process` + `task_started` mapping + flip capability flag); compaction UI.
*Accept:* each feature demoed on a real session; capability flags truthful.

**P5 — Periphery** (legitimately deferrable): remote node (`apps/cli` harness package pattern — dsh's pure-TS spine actually makes this easier than Claude's binary), mobile event stripping exemptions (tool `meta` payloads!), usage page, packaging (plain-JS deps → no asar-unpack needs beyond the bash spawn-helper if bundled; verify `require.resolve` paths on Windows).

Estimated shape: backend + bridge ≈ Claude-backend-sized (~500–800 lines); the long tail is the ~40 enumeration surfaces (Cursor: 152 files). P0–P3 is a shippable alpha per the OpenCode/Cursor precedent.

---

## 10. Testing strategy

- **Mapper tests**: table-driven over recorded dsh session logs (record via the spike's event tap; the log is lossless JSON, perfect fixture material). One fixture file per flow (text turn / tool turn / approval / cancel / compaction), per repo convention.
- **Keep the spike** as `packages/deepseek/tests/spike.e2e.ts` (mock adapter, no network): it is the canary for dsh upgrades — it exercises boot, streaming, tools, approval, cancel, hot-swap in ~3 s.
- **Store-routing tests** per existing harness-handler patterns.
- Run from `apps/desktop` cwd (vitest alias footgun); no real better-sqlite3 in tests.

## 11. Version & risk strategy

| Risk | Mitigation |
|---|---|
| rc breaking changes (promised) | Exact-pin the family to one version in `packages/deepseek` only; no `^`. Upgrades are deliberate PRs: bump → run spike e2e + mapper fixtures → fix → land. Never mix family versions (footgun 3). |
| API drift in seams we touch (`SessionEventMap`, approval, tools, llm) | All dsh vocabulary confined to `packages/deepseek` (D4); blast radius is one package. The seams we use are dsh's own extension points (ACP/Web client use the same ones), the least likely to break silently. |
| rc quality issues in the loop | Invariant companions stay mounted in dev; they fail loud at the source. |
| Send-during-teardown latch (footgun 2) | Backend gates sends on `whenIdle`; parked input surfaces as queued-message UI. |
| Postinstall trust (bash executor) | Document `bun pm trust` needs; consider bundling the spawn helper explicitly at packaging time. |
| Provider auth model mismatch | We bypass dsh's credential files entirely (D7); credentials flow through existing SuperOne bindings. |
| dsh Python/native components | Not in our path: python SDK, landlock (Linux sandbox), e2b are unmounted. |

## 12. Resolved questions (decided with the user, 2026-08-18)

1. **Persona/system prompt** → **keep dsh's harness identity**, inject SuperOne additions through the `persona` field (matches the Claude/Codex precedent; preserves behavior comparability with upstream dsh).
2. **Permission vocabulary** → **show dsh's own permission-preset names**; shared `PermissionMode` remains the carrier type across store/wire surfaces, mapped Codex-style (see D5).
3. **Sandbox** → ✅ Landed — §20. dsh's own `sandbox-local` is mounted rather than SuperOne's macOS sandbox, and `sandboxHarness.ts` still returns `false`: the preset IS the sandbox mode, so a second toggle could only contradict it.
4. **utilityProcess trigger** (owner: engineering) → revisit D1 when either (a) the bash/PTY executors land in the main process, or (b) the event trace shows dsh-attributed main-process stalls.
5. **`tool-cordis`** → **user-facing opt-in setting**, default off, lands in P4 (see D9). ✅ Landed — §19.

---

## Appendix: reproducing the spike

```sh
mkdir /tmp/dsh-spike && cd /tmp/dsh-spike
echo '{"name":"dsh-spike","type":"module","private":true}' > package.json
bun add @deepseek-ai/dsh@0.1.0-rc.7        # or the current pinned version
cp <repo>/docs/draft/deepseek-harness-spike.mjs .
node deepseek-harness-spike.mjs             # or: bun deepseek-harness-spike.mjs
```

Expected tail: `[E5b] tools with hot plugin: [extra,ping] | after dispose: [ping]` and a summary counting `turn/start:5 … tool/call:1 approval/asked:1 tool/result:1`.

---

## 13. Official composition inventory (`dsh-base`, 2026-08-19)

Product principle (aligned with the user, 2026-08-19): **integrate the official
harness first; where an official plugin conflicts with a SuperOne surface — UI,
transport, identity — use ours.** "Not integrated yet" is not the same as
"replaced by ours", and D3 blurred the two.

### 13.1 Where the official composition lives

The official deployment composes from **bundles**, not hand-written plugin lists:

```jsonc
// $DSH_HOME/profiles/web/package.json
"dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"] } }
```

Each bundle ships a `cordis.patch.yml` — `dsh-base` inserts 79 rows, `dsh-web-app`
overrides some and inserts the browser/host plane. The user's own
`$DSH_HOME/profiles/<p>/cordis.patch.yml` is the last layer (this is the file our
MCP CRUD writes, §D6).

`dsh-base` carries **no `dsh-mcp-client` row**. Third-party MCP is a user-profile
concern in the official design too, which is exactly where we put it.

### 13.2 Version trap — `latest` is stale, use `next`

| dist-tag | version | published |
|---|---|---|
| `latest` | `0.0.1-rc.1` | 2026-08-10 (first publish, never moved) |
| `next` | `0.1.0-rc.7` | 2026-08-17 (our pinned line) |

`npm add @deepseek-ai/dsh-<x>` with no version resolves to the **oldest** release,
and that release uses **different package names** for the same capability:

| 0.0.1-rc.1 | 0.1.0-rc.7 (ours) |
|---|---|
| `dsh-permission` | `dsh-permission-presets` |
| `dsh-compact-basic` | `dsh-compaction-basic` |
| `dsh-subagent-spawn` | `dsh-subagent-spawn-in-process` |
| `dsh-user-interaction` | `dsh-user-questions` |
| `dsh-tasks-local` / `dsh-tool-tasks` | `dsh-jobs-local` / `dsh-tool-jobs` |
| `dsh-bash-env` | `dsh-shell-env` |
| `dsh-settings-local` | `dsh-settings-file` |
| `dsh-fs-policy` | `dsh-fs-observation-policy` |
| `dsh-timeout-policy` | `dsh-tool-call-timeout-policy` |
| `dsh-repeat-tool-guard` | `dsh-repeat-tool-reminder` |
| `dsh-workflow-workerthread` | `dsh-workflow-worker-thread` |
| `dsh-compact-tool-result-prune` | `dsh-compaction-tool-result-pruner` |

Always pin `0.1.0-rc.7` explicitly. A bare install silently gives a different
harness whose rows do not match anything written here.

### 13.3 The gap: 21 of 79 rows mounted

**Mounted today** — tree (12): `timer` `llm` `session` `system-prompt` `tools`
`agent` `agent-loop` `user-approval` `llm-deepseek` `session-persistence-jsonl`
`session-checkpoint-policy` + our credential plugin. Per-agent tool plane (8):
`subprocess-local` `fs-local` `bash-local` `shell-env` `tool-fs` `tool-fs-search`
`tool-bash` `tool-todo`. Deployment (1): `mcp-client`.

**Conflicts — keep ours, exclude theirs:**

| Official row(s) | Why ours wins |
|---|---|
| the whole `dsh-client-ui-*` roster (21 rows) | SuperOne is the UI |
| `host-webserver` `host-apiproxy` `client-connection` `client-modules` `api-remotes` `web-app` `web-startup` `client-hmr` `host-directory-picker-auto` | browser transport; we use Electron IPC |
| `typert-registry` `typert-loader` `api-gateway` | RPC gateway for that transport |
| `hmr` | we are embedded in Electron main |
| `session-title` + `session-title-first-prompt-llm` | SuperOne titles sessions via `session_rename` |
| `agent-default-model` | SuperOne owns model selection (D7) |
| `commands` `command-feedback` `command-goal` `command-compact` | SuperOne owns the slash surface |
| `settings-file` `credentials-local` | currently ours (D7) — worth re-deciding under the "respect the harness's own config" principle |
| **`session-telemetry-otel`** | **must exclude** — mounted on by default, mirrors *every* session-log event to `harness-telemetry.deepseeksvc.com`. Disable the row (config cannot turn it off). |

**Capability rows we simply have not integrated yet** (no UI conflict — this is
the actual backlog):

| Group | Rows |
|---|---|
| subagents | ~~`subagent`~~ ~~`subagent-spawn-in-process`~~ ~~`subagent-fork-in-process`~~ ~~`tool-subagent`×2~~ (landed, §17) · still out: `tool-subagent-control`(+`/list-agents`), `tool-subagent-report` |
| compaction | ~~`compaction-basic`~~ ~~`compaction-tool-result-pruner`~~ ~~`token-meter`~~ (landed, §18) |
| permission / sandbox | ~~`permission-presets`~~ ~~`sandbox-local`~~ ~~`sandbox-policy`~~ ~~`bash-sandbox`~~ ~~`fs-sandbox`~~ (landed, §20) · still out: `pwsh-sandbox` + `tool-pwsh` on Windows |
| context & durability | `session-projection` `spill-local` `spill-policy` `token-meter` `tool-call-timeout-policy` |
| model plane | `llm-retry` `llm-pi-ai` (dormant multi-provider adapter) |
| tools | `tool-str-replace-editor` `tool-jobs` + `jobs-local` `tool-ralph` `tool-workflow` + `workflow-worker-thread` |
| HITL & modes | `user-questions` `plan-mode` |
| content | `attachment-local` `session-query-sqlite` `web` + `web-search-deepseek` + `tool-web` |
| prompt & policy | `agent-instructions` `fs-observation-policy` `repeat-tool-reminder` |
| skills / goals | `skill` `skill-filesystem` `skill-badge` `tool-skill` · `goal` `goal-round-driver` `tool-goal` |

### 13.4 `agent-presets` confirms the tool-plane shape

`dsh-web-app` disables every per-agent row from `dsh-base` (`tool-bash`, `tool-fs`,
`tool-todo`, `tool-subagent*`, `plan-mode`, `token-meter`, `compaction-basic`, …)
and re-mounts them behind **`dsh-agent-presets`**, one composition per session,
while the *registries* (`subagents`, `jobs`, `skill`, `goals`, `shell-env`) stay on
the host plane because they are process singletons with cross-session queries.

That is the same split we arrived at independently in `tool-plane.ts`
(`agentCtx.isolate(...)` per agent, deployment-level MCP mounts). The official
criterion is sharper and worth adopting verbatim: **a service a row outside the
realm reads belongs to the plane both can see.** Our `mcp-servers.ts` placement
follows it; `subagents` will require it (the registry is a process singleton with
`listChildren`/`followup`).

---

## 14. Loader feasibility: asar dynamic-import probe (verified 2026-08-19)

**Question.** `@deepseek-ai/cordis-plugin-loader` resolves plugins with a bare
specifier held in a *runtime variable* (`await import(name)`) plus
`createRequire().resolve(name)`. Does that survive an Electron asar package?
A literal specifier would be statically analyzable and would not answer it.

**Method.** A temporary main entry (`src/main/dsh-asar-probe.ts`, since deleted)
built through electron-vite, packaged with `electron-builder --dir --mac`
(unsigned), then run two ways against the same 654 MB `app.asar`: once as
`ELECTRON_RUN_AS_NODE=1` (fork-node context, how `llm-proxy-entry` runs) and once
in the **real Electron main process** behind `SO_DSH_ASAR_PROBE=1`.

**Result — both contexts, all green.** `import.meta.url` confirmed inside
`app.asar`; every resolution landed on
`.../app.asar/node_modules/@deepseek-ai/<pkg>/lib/index.js`.

| Package | `await import(runtimeVar)` | `require.resolve` |
|---|---|---|
| `@deepseek-ai/cordis` | ok (`Context`, …) | ok, inside asar |
| `@deepseek-ai/dsh-tool-bash` | ok (`Config`, `apply`, `inject`) | ok, inside asar |
| `@deepseek-ai/dsh-tool-todo` | ok | ok, inside asar |
| `@deepseek-ai/dsh-session` | ok | ok, inside asar |

Module identity also holds: `(await import(name)).default === staticImport` and
the two namespaces are `===`. A dynamically loaded plugin is the *same module
record* a static import gets, so nothing about Loader-mounted plugins differs
from the tree we hand-write today.

**One false alarm, recorded so it is not re-investigated.** The probe also tried
mounting a dynamically imported `dsh-tools` on a bare `new Context()` and
reported `FAIL service missing`. That reproduces **identically outside the
package** (plain `node` against `node_modules`): `dsh-tools` declares injects and
stays dormant until the spine services exist, so a bare Context never gets
`ctx.tools`. Not an asar finding.

**Conclusion.** The asar risk that gated adopting the Loader is **cleared**.
`cordis-plugin-loader` is 25 KB, its only `dependency` is `cosmokit` (already
installed) and its peers are `cordis` (installed) + `node-addon-require-builtin`,
which is **optional**: `loader.internal` (Node's internal ESM ModuleLoader, used
only for HMR cache eviction) is `ModuleLoader | undefined`, and the loader falls
back to plain `await import(name)` when absent. Adopting the Loader without HMR
therefore introduces **no native module**.

Remaining caveats for whoever implements it:

- Anything the Loader may mount must stay a **declared dependency** of
  `apps/desktop`, or electron-builder will not pack it. Externalization already
  works this way (`mainExternal` = every non-`@superone/*` dep), and the probe
  confirmed all 409 `@deepseek-ai` asar entries are present.
- HMR (`cordis-plugin-hmr`) needs the native addon and Node ESM internals —
  skip it. File-watch reload is better served by our own `fs.watch` +
  `loader.update()`.
- Runtime *download* of a not-yet-installed plugin is a separate problem
  (asar is read-only) and belongs with the harness hot-swap work, not here.

---

## 15. Adopted: `ctx.loader` as the runtime entry tree (2026-08-19)

D3 said "no Loader" and meant "no YAML/profile/bundle machinery". That reading
still holds, but it over-reached: the Loader **service** is separable from its
file-backed half, and it is the right home for any row that changes while the
tree runs. `packages/deepseek/src/tree.ts` now mounts:

```ts
ctx.plugin(Loader, { baseUrl: import.meta.url })
```

Deliberately **not** mounted: `cordis-plugin-include` (YAML-backed trees) and
`cordis-plugin-hmr` (needs Node ESM internals via a native addon). `Loader.write()`
is a no-op, so nothing this tree holds is ever persisted.

### What it replaced

`DeepseekMcpServers` was a hand-rolled loader: identity = the whole connection
tuple, and any field change meant `dispose()` then `ctx.plugin()` again. Now
identity is the **sanitized server name** and a config change is
`loader.update(entryId, { config })` — an in-place restart of that row. This
matters because `dsh-mcp-client` reserves `serverName` **process-wide**: the old
dispose-then-remount briefly released that reservation. Entry ids are
`mcp-<serverName>`, matching dsh's own patch-file convention, so a running tree
reads like the file the user edits.

`sync()` and `dispose()` became async; both call sites in `runtime.ts` await them.

### Cordis footgun, hit twice

`ctx.loader` **throws** (`cannot get property "loader" without inject`) for a
consumer that did not declare `inject: ['loader']` — it does not return
`undefined`. Anything optionally depending on a service must use
`ctx.get('name')`. This bit production code and test code in the same change,
and is the same rule that forced `ctx.get('sessionPersistence')` in §D8.

A second face of it: a service obtained through `ctx.get()` is a **tracked proxy
bound to the caller's context**, so inside its methods `this.ctx` is the
consumer's context, not the service's. Calling `loader.import(specifier)`
directly from a test therefore throws, while `loader.create({ name })` is fine —
the entry resolves the module through the tree's own context. Test the create
path, not the import primitive.

### Test seam

`loader.import()` treats a `cordis:<key>` specifier as a lookup in
`loader.builtins`, so tests register a fake server plugin there and construct
the registrar with `cordis:<key>`. The loader path under test is then the
production one; only the module behind the specifier differs. One test
deliberately uses the **real** `@deepseek-ai/dsh-mcp-client` specifier against an
unreachable endpoint, because a builtin-only suite would keep passing if the
real package were renamed or dropped from the manifest (mutation-checked: it
fails with `expected [] to include 'mcp-probe'`).

### Follow-ups this unlocks

- **B — config edits take effect live.** `fs.watch` on the profile patch file +
  `loader.update()`; no `include`/`hmr` needed. Today a settings-page MCP edit
  waits for the next session.
- **C — `dsh-tool-cordis`** (model edits its own plugin tree) stays out: its
  README calls its sandbox "not a security boundary" and says to treat it like
  bash access, and its dynamic packages are process-wide, which crosses
  SuperOne's Layer-A tool-identity model. Opt-in, default off, if ever.
- Harness hot-swap (memory: `project_harness_hot_swap`) now has its mount
  mechanism; only the *download* half (asar is read-only) remains open.

---

## 16. Live config reload (B, 2026-08-19)

SuperOne keeps no copy of dsh's MCP list — the harness's profile patch layer is
the only source (§D6) — so an edit made *anywhere* has to reach a running tree
the same way. Before this, an edit waited for the next session to start.

`apps/desktop/src/main/deepseek/`:

| Module | Role |
|---|---|
| `deepseek-mcp-watcher.ts` | `watchDshMcpConfig(onChange, opts)` — debounced (150 ms) notification that the patch file changed |
| `deepseek-mcp-sync.ts` | `readDshMcpServerSpecs(cwd)` (moved out of `deepseek-backend.ts`) + `trackDshMcpConfig(cwd)` / `stopTrackingDshMcpConfig()` |
| `deepseek-runtime-host.ts` | new `peekDeepseekRuntime()`; `disposeDeepseekRuntime()` stops the watch |

`DeepseekRuntime.syncMcpServers(specs)` is the new public seam. Creating an agent
still syncs from a fresh read; the watch covers only the other case. Both funnel
into the same fingerprint-diffing registrar, so a redundant call is free.

Three decisions worth keeping:

- **Watch the directory, not the file.** Our own `saveDshMcpConfig` writes in
  place, but vim/VS Code save by writing a temp file and renaming over the
  target — that replaces the inode and a file watch silently follows the dead
  one. Pinned by a `renameSync` test.
- **`peekDeepseekRuntime()`, not `getDeepseekRuntime()`.** A file change is an
  *ambient* signal, not user intent. The eager accessor would boot a whole dsh
  tree because someone added a server in Settings without ever opening a
  DeepSeek session. Worth copying wherever else a singleton reacts to ambient
  events.
- **`mkdirSync` the profile directory before watching.** It is the same
  directory `saveDshMcpConfig` creates on first write. Without it, a user
  adding their *first* server is exactly the edit that goes unnoticed.

`cwd` is the newest session's. It only decorates stdio servers, and the mounts
are deployment-level, so last-session-wins — the same rule that already applied
before the watch existed. Not a new inconsistency, but a real one: two projects
with different cwds share one mount.

Tests: `deepseek-mcp-watcher.test.ts` (6, real fs incl. atomic-rename save,
event coalescing, arming before the directory exists) and
`deepseek-mcp-sync.test.ts` (5, real `saveDshMcpConfig`/`toggleDshMcpConfig`
writes; only the tree is stubbed, because booting one needs Electron's userData
path).

---

## 17. Subagents (P4e, 2026-08-19)

Foreground delegation runs. `dsh-subagent` (provider registry) +
`dsh-subagent-spawn-in-process` (fresh child Agent, this process) +
`dsh-tool-subagent` (the one model-facing row, `toolName: 'subagent'`,
`maxDepth: 3`) are mounted unmodified in `tree.ts`.

### The finding that reshaped the tool plane

dsh composes a child agent with one call — `applyChildComposition(childCtx,
parent, composition)` — which **joins the parent's `dsh-agent-presets`
composition** before applying the child's own persona and tool filter. Its
README states the consequence directly: *"a child that joined nothing would
reach the model with an empty tool registry."*

That left three possible shapes, only two of them official:

| Shape | Where model-facing rows live | Verdict |
|---|---|---|
| Preset roster (`dsh-web-app`) | per-preset standing mount, joined by scope-key parenting | needs preset **directories** with `agent.cordis.yml` on disk — the YAML composition D3 exists to avoid |
| Rosterless (`dsh-base`) | the host composition; children resolve them through the tool registry's global layer | matches D3; `composeFrom()` returns `undefined` for a rosterless parent and that is explicitly *"not an error"* |
| What we had | the **parent's agent scope**, no roster | neither — a child joins nothing *and* finds nothing globally |

So P4a's per-agent mount was not a conservative choice, it was an unrepresented
one: it worked precisely because nothing had ever tried to create a child.

**Adopted the rosterless shape.** `mountHostToolPlane(ctx)` moves the executors
and the `tool-fs`/`tool-fs-search`/`tool-bash`/`tool-todo` rows to the tree's
global layer.

The isolation P4a bought with `agentCtx.isolate('fs'|'shell'|…)` turns out not
to have been load-bearing. dsh resolves the workspace **per call, at the tool
boundary** — `tool-fs` passes `exec.agent.session.header.cwd` into
`ctx.fs.resolve()` and `tool-bash` defaults `workdir` from the same field
(`.agents/notes/…/2026-07-02-fs-per-session-cwd.md` in dsh's tree). `config.cwd`
is only the fallback for a caller with no agent. The evidence is that the
"keeps each session rooted in its own cwd" test — written to prove the isolation
was necessary — passes unchanged with one shared `ctx.fs`.

### The permission gate had to move for a second reason

A `tools/pre-execute` listener on the parent's agent scope never observes a
child's executions. Left there, a delegated child would run `write` and `bash`
with **no prompt at all** — a strictly worse hole than the one P4a's gate
closed. It is now installed once on the bridge, and resolves its answerer per
call:

- the calling agent's dsh session id comes from `exec.agent.session.header.id`;
- a child is absent from `DeepseekRuntime.records`, so `ownerOf()` walks
  `header.parentSession` through the live session store (bounded at 8 hops)
  until it reaches the SuperOne session the user is looking at.

The two empty outcomes of that walk are deliberately different. A session that
configured **no answerer** returns `undefined`, which defers the call to dsh's
own approval waterfall — that is what keeps chat-only and MCP-only sessions
behaving as they did. An agent that resolves to **no SuperOne session at all**
is refused: an effect nobody can attribute is an effect nobody can approve.

`subagent` itself joins the read-only set. Delegating is not an effect, and
every effect it causes is gated under the child's own call; prompting for both
would ask twice for one action.

### Deliberately not enabled

- **`run_in_background`.** The one-shot background route registers a
  parent-owned Task whose status/collection/kill tools (`job_output`,
  `job_kill`) are a surface SuperOne does not render. Exposing it would let the
  model start work the user can neither see nor stop. Foreground only until the
  Task block lands.
- **Continuable children** (`startContinuable`, `send_message`, `list_agents`)
  — a durable multi-turn child conversation is a product surface, not a mapping.

### Known gaps

- **A child does not get SuperOne's own tools.** `mountSuperoneTools` stays on
  the agent scope because the surface is per session — feature gates, registered
  mini-apps, whether a phone is subscribed. A child therefore runs with dsh's
  file/search/shell/todo tools alone. Fixing it means a session-resolved
  surface on the host plane, keyed off `exec.agent.session.header.id` and its
  ancestry the same way the permission gate now is.
- **`session-projection` is unmounted**, so `listChildren()` / `listDescendants()`
  would fail loud. Nothing calls them yet; they become required with
  `list_agents`.

### The Task block (landed)

`subagent` is renamed to `Task` in the mapper's canonical table, because
`isSubagentToolName()` matches `Agent`/`Task` **exactly** — that string is the
whole switch between a generic tool row and the collapsible subagent segment.

**Linking a child to its delegation call is the hard part**, and dsh gives you
almost nothing to do it with. `subagent/start` carries `{runId, provider, id,
local}` — the child's session, not the tool call that asked for it. Its declared
second argument, `parent: Agent`, **never reaches a listener**: the contained
lifecycle emitter dispatches with the parent as the scope *carrier*
(`ctx.events.dispatch('emit', [carrier(parent), name, info])`) and then invokes
each callback as `callback(info)`. A listener written to the published signature
throws on `parent.id`, and the emitter swallows it into a `logger.warn` — which
is exactly how this failed silently the first time.

So both halves come from our side, through an `AsyncLocalStorage` span opened in
a `tools/execute` wrapper (dsh's own around-dispatch seam;
`tool-call-timeout-policy` is the precedent). The span carries the call id, the
model's `description`, and the delegating agent's session id, and
`provider.start()` is awaited inside it. A plain "last delegation wins" variable
would not survive `maxParallelToolCalls` — sibling delegations in one assistant
message overlap by design.

**Child blocks join the parent's message.** `ChatMessage.tsx` rebuilds the
subagent subtree by scanning `parentToolUseId` stamps within **one message's**
`content` array, so a nested mapper publishes no `message_start` of its own; it
resolves the parent's open message id at emit time and stamps every block. Three
things are suppressed in nested mode for the same "it is not the parent's" rule:
`todos_updated` (session-wide — a child's plan would overwrite the panel),
`turn/end` interrupt/error mapping (the child's failure arrives as the
delegation tool's errored result), and `message_usage`, which becomes
`subagent_usage` instead.

Lifecycle maps to `task_started` (on `subagent/start`, `taskId` = the run id,
`toolUseId` = the delegation call) → `task_progress` (throttled to
`tool/call`/`tool/result`/`assistant/message`/`step/end`; every chunk would be
one store write per token) → `task_notification` with `completed` / `stopped` /
`failed` derived from dsh's stop reason. `outputFile` is `''`: dsh keeps the
child transcript in its own JSONL log, which "open full view" cannot read yet,
and the reducer treats an empty path as absent.

`subagent_fork` is a second `tool-subagent` instance over
`dsh-subagent-fork-in-process`: one instance binds one provider to one tool
name, and the tool derives its own description from
`provider.inheritsParentContext`, so the model is told which of the two it is
choosing. Fork seeds the child with the parent's contiguous prefix up to the
last `turn/end` — the completed turns, never the in-flight one that is
delegating. Both render as the same `Task` block.

Nesting beyond one level needs no extra work — a depth-2 delegation's own
`Task` block is itself stamped with the depth-1 call id, which is what
`topAncestorSubagent()` walks.

Tests: 5 more in `subagent.test.ts` — the rename, the `task_started` /
`task_notification` pair keyed on the delegation call and sharing a run id, a
child block landing on the parent's message under the right
`parentToolUseId`, the negative case (no extra message published, no
`todos_updated` from the child), and a fork child reading a secret its parent
said in an earlier completed turn (mutation-checked: pointing the
`subagent_fork` row at the spawn provider fails it).

Tests: `subagent.test.ts` (3) — a delegated child writes a file in the parent's
workspace (the host-plane proof: with per-agent tools the child's registry is
empty and no file appears), its `write` reaches the parent's answerer tagged
with the *child's* session id while `subagent` itself never prompts, and a
rejection leaves no file.

---

## 18. Compaction (P4f, 2026-08-19)

`dsh-token-meter` + `dsh-compaction-basic` + `dsh-compaction-tool-result-pruner`
mounted unmodified in `tree.ts`. `supportsCompact` is now true.

**`auto` stays on** (its default). The step-boundary pressure listener and the
provider-overflow recovery path are the whole reason a long dsh session
survives; a harness that only compacts when asked is one that dies at the
context wall. Compaction happens at `0.8 × routedContextWindow`, keeps a
`0.16` tail, prunes oversized tool results before summarizing, and summarizes
through a direct `llm.stream()` call marked `purpose: 'compaction'`.

**`dsh-command-compact` is NOT mounted.** SuperOne owns the slash surface, so
the manual path is `DeepseekBackend.send()` intercepting `/compact` →
`DeepseekRuntime.compactSession()` → `ctx.compaction.compactNow()`. That keeps
the whole `commands` family out of the tree, consistent with §13.3.

### The bracket is the mapping

dsh writes one compaction as `compaction/start` … `compaction/summary` …
`compaction/end`, all log-only, with the actual surface mutation riding a
`user/message` (`surfaceOp: replace`) between the last two. So the transcript
events come from the mapper, not from the backend:

| dsh | SuperOne |
|---|---|
| `compaction/start` | `status_indicator: 'compacting'`; `turn: null` ⇒ `trigger: 'manual'`, a numeric owner ⇒ `'auto'` |
| `compaction/summary` | remembers `shadowedTokenCount` as `preTokens` and the summarization `usage.outputTokens` as `postTokens` |
| `compaction/end` | `compact_boundary` + `status_indicator: null, compactResult: 'success'`, or the `failed` indicator when it carries `error` |

The replacement `user/message` is deliberately **not** mapped: it shadows
history the chat panel is already showing, so rendering it would duplicate the
transcript rather than compact it. A test asserts the summary text never
reaches the event stream.

The backend handles only the rejection path — `compactNow` rejects *before*
appending anything for `busy` and `changed`, so nothing in the log would tell
the UI what happened. It also emits `status_change: idle`, because `/compact`
opens no turn and nothing else would clear the optimistic streaming state.

`/compact` is dsh's only slash entry (`ChatInput.tsx`). It borrows
`chat.codexCommands.compactDesc` for its label — shared wording, not a shared
surface; a dsh-owned i18n key is a small follow-up. `isCompactSlash` in
`send-message.ts` now includes `dsh`, so the typed message is replaced by the
boundary row instead of sitting unanswered.

### Known gaps

- **No context-pressure UI.** `ctx.tokenMeter` knows the live pressure ratio;
  the context gauge still derives from `request/context` usage.
- **The retention policy is dsh's default** (`0.8` / `0.16`), not a setting.

Tests: `compaction.test.ts` (3) — the manual bracket end to end against the
real engine (indicator → `compact_boundary {trigger:'manual', preTokens>0}` →
success), the negative case that no transcript message or summary text escapes,
and two racing compactions where dsh's durable lock rejects the loser without
leaving the indicator spinning.

### Unrelated fix carried here

`deepseek-mcp-watcher.test.ts` had gone red on this machine. `fs.watch` returns
before the platform watch is necessarily live — on macOS the FSEvents stream
starts asynchronously — so a write issued in the same tick could be missed, and
a fixed 120 ms wait made the assertions hostage to FSEvents latency besides.
Production never races either one (the watch arms at session start; the user
edits much later). The tests now await arming and poll for the callback, with a
fixed wait kept only where elapsed time is the evidence (the negative cases and
the debounce count).

---

## 19. `tool-cordis` opt-in (P4g, 2026-08-19)

The last item of §12.5. `AppSettings.dshToolCordis`, default **off**, gates
`dsh-cordis-host-runner` + `dsh-tool-cordis` — seven tools that let the model
inspect the live runtime, define a plugin, run it in this process, stop it and
forget it.

**Why an opt-in and not a permission rule.** Its own README is unambiguous: the
vm sandbox "is not a security boundary", "treat this toolset like bash access",
and a dynamic package lives in shared process memory so it "may affect other
sessions in that process". SuperOne's Layer-A/Layer-B model gates a *call*; it
has nothing that scopes what a package does once it is running, or that keeps
one session's package out of another's. The coarse grant is therefore the
honest one, and the per-call permission prompt stays on top of it — every
`cordis_*` call still parks on the popover, including the read-only reports,
because after the opt-in the prompt is the only remaining brake.

**It toggles live, not at boot.** The tree is one per app lifetime, so a boot
flag would mean "restart to apply" — the wrong contract for a switch whose *off*
position withdraws the model's ability to run code in this process. Cordis
registrations are reversible effects and dsh re-assembles the request's tool
list from the registry every turn, so `DeepseekRuntime.setToolCordisEnabled()`
mounts or unmounts the pair and the next turn of every session sees the change.
The settings handler calls it through `peekDeepseekRuntime()`, so toggling never
boots a tree.

Both rows travel together: the toolset injects the runner's service, and — the
one thing that cost a red test — **the mounts must be awaited**. An unawaited
`ctx.plugin()` pair leaves the tools dormant with an unchanged registry, which
looks exactly like the switch not working.

**Registry over README.** `0.1.0-rc.7` registers `cordis_inspect_list` /
`cordis_inspect_query` / `cordis_inspect_self`, not the single `cordis_inspect`
the README documents. The test reads the names off `ctx.tools.schemas()` for
that reason.

Surfaces: `AppSettings` + the four `app-settings-service.ts` sites, a
`DeepSeek → Preferences` tab in `HarnessesSettingsPage` rendering
`DshPreferencesPage` (`PreferencesPage` edits `~/.claude/settings.json`, which
is not dsh's), an `agent-dsh` domain in `settings-registry.ts` so `config_read`
/ `config_apply` can see it, and en/zh strings.

Tests: `tool-cordis.test.ts` (4) — absent by default while the file and shell
tools are unaffected, present when opted in at boot, appearing and disappearing
on a running tree, and idempotent because the settings handler calls it on
every change. Plus an `app-settings-service.test.ts` round trip, since a
deliberate opt-in that gets re-defaulted on the next save is worse than no
setting.

---

## 20. Sandbox + permission presets (P4h, 2026-08-19)

The last of §12's open questions (§12.3 scheduled the sandbox spike "after P4";
this is it). Five rows land together, because none of them is useful alone:

| Row | Owns |
|---|---|
| `dsh-sandbox-local` | the platform runner — Seatbelt on macOS, bwrap-then-Landlock on Linux, a restricted token on Windows |
| `dsh-sandbox-policy` | the one place a mode and a workspace root are resolved, per call |
| `dsh-bash-sandbox` | **replaces** `bash-local`: wraps the exact argv in the runner |
| `dsh-fs-sandbox` | **replaces** `fs-local`: a per-call mode fence on `writeText`/`editText` |
| `dsh-permission-presets` | the user-facing vocabulary, bundling a sandbox mode with an approval policy |

**Both fences or neither.** `bash-sandbox` alone was the tempting cut — it is
the one the permission-preset service hard-requires (`ctx.shell.sandboxMode`).
It would also have produced the worst possible state: `bash` blocked from
writing outside the project while `write` and `edit` walked out unconfined,
with a UI claiming "workspace write". `fs-sandbox` exists precisely so the two
families resolve the *same* per-call policy, and dsh's own docs call that
non-drift the point of a shared `ctx.sandboxPolicy`.

They are not the same kind of fence and the packages say so: the filesystem one
is a containment check in trusted code over a model-controlled path
("containment, not a security boundary"), while bash gets kernel confinement.
Keeping both means the weaker one is never the *only* thing standing between the
model and a path.

### The preset table

dsh ships two entries; a third is added because SuperOne offers a
look-but-do-not-touch mode on every other harness and dsh's sandbox vocabulary
already had the mode — only the preset row was missing.

| Preset | sandbox | approval | Carrier `PermissionMode` |
|---|---|---|---|
| `read-only` | `read-only` | ask | `plan` |
| `workspace-write` (default) | `workspace-write` | ask | `default` |
| `danger-full-access` | `danger-full-access` | never | `bypassPermissions` |

`plan` carries `read-only` because that is what SuperOne's plan mode enforces
wherever it exists: look, do not touch. dsh has no plan *approval* round trip
and nothing claims otherwise — `permissionMode === 'plan'` on its own drives no
plan UI, and `supportsPlanMode` stays false.

`PRESET_BY_MODE` is an **exhaustive** `Record<PermissionMode, …>` on purpose.
`PermissionMode` is shared across every harness, so a new member should force a
dsh decision rather than fall through a default — the one seam here a compiler
can hold. Four members (`acceptEdits`, `dontAsk`, `auto`, `agent`) are not
offered in the picker and map to the default; auto-approval *without* dropping
confinement is simply not a bundle dsh's preset table can express.

**Two halves, deliberately.** `packages/deepseek/src/permission-presets.ts` owns
the knob bundle and the mode map; `deepseekPermissionModes.ts` owns the labels.
The renderer must not pull dsh's runtime into its bundle, so the table cannot be
one module.

**Sandbox stays off the second axis.** `harnessSupportsSandbox()` still returns
false for dsh, for the Codex reason: the preset *is* a `sandbox/mode`, so a
separate sandbox toggle would be a way to contradict the choice just made.

### Switching is a durable event, not a flag

`setPermissionMode` translates to a preset and calls
`ctx.permissionPresets.set()`, which appends `sandbox/mode` + `approval/policy`
to that session's own log. So the switch survives resume by replay, never leaks
into a sibling session, and — the part that matters — the *fences* follow it,
because both read the effective mode per call. A mode that only changed the
popover would be theatre.

### Risks taken knowingly

- **Fail-closed is dsh's design.** `sandbox-local` reports `SANDBOX_UNAVAILABLE`
  rather than ever running unconfined, so on a Linux box with neither `bwrap`
  nor Landlock every `bash` call fails until the user picks
  `danger-full-access` (which never consults the provider). That is the right
  default and the wrong error message; a friendlier surface is follow-up work.
- **Packaging.** `sandbox-local` pulls `@deepseek-ai/node-addon-landlock-run`, a
  native addon. Unused on macOS, but P5 packaging has to unpack it from the asar
  for Linux builds.
- **Seatbelt is deprecated.** Apple still ships `sandbox-exec` on every macOS;
  the functional probe is what fails closed if that ever stops.

Tests: `sandbox.test.ts` (6) — the fs fence allows a write inside the project,
refuses the same write under `read-only`, refuses one outside the project under
`workspace-write`, and allows it under `danger-full-access`; then the kernel
fence, with a real `bash` redirect blocked under `workspace-write` and let
through under `danger-full-access`. Plus a backend test that the shared mode is
actually translated into a preset.

**A vacuous green worth recording.** The first cut of both bash tests passed —
and proved nothing. `bash` requires a `description` argument, so dsh rejected
the call with `invalid arguments` before the sandbox was consulted, and "the
file was not created" was true for the wrong reason. It only surfaced because
the *positive* control (full access should let the write through) failed. Both
tests now assert the call actually ran. A negative sandbox assertion needs a
positive twin, or it tests nothing.

The test's "outside" directory is under `homedir()`, not `tmpdir()`:
`workspace-write` grants the platform temp areas as writable roots — the same
set the Seatbelt profile grants — so a sibling temp directory would have been
allowed and the test would have been vacuous a second way.

## 21. Trajectory (2026-08-19)

dsh's Web GUI carries a second conversation view beside Chat, labelled `轨迹`
(`packages/client/ui-trajectory`, ~10.5k lines): a turn-aware ledger over the
raw session log with a local inspector. It is not a skin over the transcript —
it exists because dsh's log is an append-only, seq-contiguous, lossless-JSON
record of *44* event types, and the ledger is the only surface that reads more
than the handful the chat needs.

Our mapper (`packages/deepseek/src/event-map.ts`) consumes 12 of those 44. That
is the right budget for a chat transcript and the wrong one for the harness:
everything that distinguishes dsh from a generic streaming backend —
`request/header` (the exact prompt and tool catalog each request was built
from), `user/message.source` (human prompt vs injected context), `approval/*` —
was landing on the floor. Projecting dsh onto `AgentEvent` alone makes it
another Claude with different weights.

### What landed

A SuperOne-native ledger rather than an embed. `@deepseek-ai/dsh-client-ui-trajectory`
is published and version-matched, but it peers React 18 against our 19 and
requires the whole dsh client runtime (cordis client tree, locale, ui-primitives,
ui-conversation, slot ring) plus its theme — a visual and dependency enclave
inside the app, coupled to a client contract that is a generated artifact.

| Layer | Where |
|---|---|
| Wire model | `packages/shared/src/trajectory-types.ts` — no `@deepseek-ai/*` type crosses into the renderer, so a dsh bump cannot reach the panel and a second producer (a Codex rollout log) can fill the same shapes later |
| Fold | `packages/deepseek/src/trajectory/{project,header,payload}.ts` — one forward pass; associations come from explicit ids (`callId`, approval `id`) or open brackets, never from wall-clock order |
| Read | `DeepseekRuntime.trajectory(sessionId)` — live sessions answer from `session.events`, closed ones load the durable JSONL |
| IPC | `AgentIpcChannels.DEEPSEEK_TRAJECTORY` → `window.app.readDeepseekTrajectory` |
| UI | `apps/desktop/src/renderer/src/components/trajectory/` — toolbar, virtualized ledger, inspector |
| Mount | `activityPanelComponents['trajectory']` + `openTrajectoryTab`; the launcher entry is gated to sessions whose harness resolves to `dsh` |

Records: `system | user | context | message | tool | compacted | approval`.
`subtool` (code-mode dispatch) and `retry` (`dsh-llm-retry`) are deliberately
absent — those plugins are not in our tree, and a record kind with no producer
is dead UI.

The fold runs in the main process and only the projection crosses IPC. A real
session's log is mostly `assistant/chunk` frames; none survive the fold, and
shipping them would move three orders of magnitude more data than the panel
renders. Inspector payloads are individually bounded at 512k chars with the
truncation declared, so one `Read` of a huge file cannot stall the channel.

### Two facts the live test corrected

`live.test.ts` projects the log a real runtime actually produced, and disagreed
with the documentation twice:

- **`request/header` is appended *inside* its step, after `step/start`.** The
  doc's "appended inside its step before dispatch" means the header a request
  used does not exist when that request opens. Reading it at `step/start`
  yields `header: null` on every request, forever. The open request adopts the
  snapshot when it arrives instead.
- **Turns and steps are 1-based.**

Neither was reachable from synthetic fixtures, because the fixtures encoded the
same wrong assumption as the code. The disk round-trip in the same file
(`fromDisk` must equal `fromMemory` on records, totals, and headers) also pins
that zstd-packed chunk rows decode back to identical timing.

### Absence is not failure

A SuperOne session exists the moment the user opens it; its dsh session only
exists once a turn has run. The first cut reported that gap as a read failure,
so opening the ledger on a fresh session showed the raw backend string
`session "<uuid>" not found`. `SessionPersistence.list` omits a
created-but-never-appended session, which separates the two cases without
matching on a backend error string, and `TrajectoryResult` carries `absent` as
a first-class answer beside `error`. The panel gives absence, emptiness, and
failure the same layout but only paints failure with the destructive accent,
and every one of them offers a retry.

### Deferred

The Overview timeline (TTFT/decode split, wheel zoom, drag-to-filter), backward
paging with prepend anchoring, and the projection of `hook/*`, `command/*`,
`tool-workflow/*`, and `tool/code-dispatch*`. The ledger currently ships the
tail 2000 records and says how many it dropped.

## 22. Agent presets — the roster adopted (2026-08-19)

dsh's Web GUI carries a mode selector — 标准模式 / PTC 模式 / 极简模式 / 创造模式 —
and it is not a prompt picker. A **preset** is a directory holding one
`agent.cordis.yml`: an agent-plane composition that decides which tools the
model gets and what its prompt says. The roster mounts each one ONCE per process
under a standing scope, and a session joins by having its agent scope parented
to that mount, so one instance of every tool and prompt section covers every
session that named it.

### Where each half lives now

`dsh-web-app` disables 24 model-facing rows from `dsh-base` and re-mounts them
behind `dsh-agent-presets`. We now have the same shape:

| Plane | Rows |
|---|---|
| Host | executors (`subprocess-local`, `sandbox-local`, `sandbox-policy`, `fs-sandbox`, `bash-sandbox`, `shell-env`), registries (`subagents` + spawn/fork + `tool-subagent-report`, `skill`, `goal` + round driver, `jobs-local`, `web` + `web-search-deepseek`, `user-questions`, `commands`), `permission-presets`, `token-meter`, persistence, the model route |
| Preset | every tool the model calls, the persona, `agent-instructions`, `plan-mode`, the compaction engine and its pruner, the delegation tools |

The criterion is dsh's own and worth restating: **a service a row outside the
realm reads belongs to the plane both can see.**

### What the compositions are, and where they come from

The four shipped presets are vendored into `apps/desktop/resources/agent-presets`
and shipped through `extraResources`, rather than read out of
`@deepseek-ai/dsh`'s own `config/`. That package is 117 KB but pulls 61
dependencies including the whole `dsh-client-ui-*` browser surface, and a preset
**is** a composition — its rows run with shell-level trust and its YAML may carry
`!!js` expressions — so the exact text that composes an agent belongs somewhere
a reviewer reads. Adopting them added 30 npm packages at `0.1.0-rc.7`.

### Four things the mount refused before it worked

Each one was a host contract the compositions assume and our tree did not meet.
None were visible from reading; the empirical loop (mount all four, read the
failure, add the host row) found them in order.

- **`cordis:group` resolved to `undefined`.** A grouped row is how a composition
  hands one `isolate` realm to a provider and its consumers together, and
  `loader.builtins.group` is registered by the HOST, not carried by the loader —
  dsh's `app-boot` does it. Without it every grouped row in every preset fails.
- **`ctx.loader` is not published synchronously.** `ctx.plugin(Loader, …)` has to
  be awaited before the builtin can be registered on it.
- **`command-compact` waited forever for `commands`.** SuperOne owns the slash
  surface and mounted no command registry, and a row still waiting on a service
  the deployment never supplies is exactly what `mount()` refuses — it would
  take the whole preset down. The registry is now mounted and renders nothing;
  that keeps the shipped composition a copy rather than a fork.
- **`compactSession` could no longer resolve the engine.** The preset puts
  compaction behind an entry-local `isolate` realm, so the only context that can
  see `ctx.compaction` is one inside that same group — which is where the preset
  also puts `command-compact`. Compaction now runs through
  `ctx.commands.execute(agent, '/compact')`, the officially supported path, and
  a handler's normalized `{kind: 'error'}` is re-thrown so the caller's contract
  survives.

### The one deviation from upstream

`standard`, `code`, and `cordis` ship their delegation rows with
`backgroundMode: continuable`, which **defaults every delegation to the
background**. dsh renders a parent-owned Task with status/collect/kill controls
for that; SuperOne renders none of them, so a background child would be work the
user can neither see nor stop — the same reasoning that kept `run_in_background`
off when the delegation tools were ours. All three vendored files pin the rows
to the foreground behind a `SuperOne deviation` banner, and
`subagent.test.ts` fails loudly if a re-copy drops it.

### Consequences worth knowing

- **A rosterless tree now has no dsh tools at all.** That is not a shape SuperOne
  ships — desktop always points the roster at the packaged root — so every test
  composes the same way production does (`src/test-presets.ts`).
- **A delegated child inherits its parent's preset**, verified rather than
  assumed: `applyChildComposition` calls `composeFrom()` behind a `?.`, so it was
  a silent no-op before the roster existed and starts working the moment one is
  mounted. Parent and child request the identical 24-tool catalog.
- **Event vocabulary rides runtime imports.** Dropping the `compaction-basic`
  import deleted `compaction/*` from the `SessionEventMap` union, because dsh
  merges each plugin's events from that plugin's own package. Consumers now name
  the packages they read with explicit `import type {}` lines.
- **A preset's `persona` row shadows the deployment persona.** A session on
  `standard` gets dsh's stock coding-agent identity, not SuperOne's — the
  earlier "keep dsh identity, append SuperOne persona" decision needs re-deciding
  at the preset layer.

### Session identity and the picker (P3/P4)

**Which preset a session runs is dsh's fact, not ours.** No SQLite column was
added: `SessionHeader.agentPreset` is durable, a blank-session switch appends
`agent-preset/selected`, and `resolveSessionPreset(header, events)` folds the
two. `createAgent` resolves the canonical id BEFORE creation and passes it as
`meta.agentPreset` — `mount()` runs inside `setup`, by which point the header is
already frozen, which is exactly what "returning the preset for the caller to
record" means. Without that record a resumed session read nothing and silently
fell back to the roster default; the resume test pins it by asserting the
resumed catalog is `minimal`'s two tools.

`switchPreset` refuses a session that has opened a turn. dsh leaves that check
to the caller because it is a product rule, not a mechanical one, and the
boundary is a turn having opened at all — not having finished.

The picker sits beside the model selector, gated to dsh sessions. With no live
agent the pick is a draft folded into the session's provider config (the
backend reads it at creation); with one, it is a real `recompose()`. The live
composition wins over the draft when both exist, because a resumed session
recomposes from its own log and the store's pick may name a preset it never ran.
A broken preset stays in the menu with its reason rather than being hidden —
hiding it would leave its directory occupying the id with nothing to delete.

`agent-preset/selected` also became a trajectory record kind. The
`request/header` that follows a switch carries the resulting prompt and tool
diff; the `preset` record is the reason that diff exists.

### 创造模式 needed the plane split applied to itself

The `cordis` preset would not mount at all, in either state of the
`dshToolCordis` opt-in:

- **Opt-in off** (the default): `tool-cordis` waited forever on
  `dynamicCordisRunner` and `cordisInspect`, because our tree only mounted
  `dsh-cordis-host-runner` inside that opt-in.
- **Opt-in on**: the preset's own `tool-cordis` row collided with the
  host-plane copy — *"Host Cordis inspect provider is already registered"*.

Two gates were competing for one capability, which is the same mistake the
plane split exists to prevent. Resolved by applying that rule here too: the
**runner and its inspect registry are host-plane services** (nothing about them
reaches the model) and mount unconditionally, while **`tool-cordis` is the
preset's row** and mounts nowhere else. Two instances cannot coexist, so the
preset is now the one and only way an agent gets those tools.

The `dshToolCordis` setting is **retired**. It offered a second way to say "give
this agent the self-modifying toolset" — a global toggle beside a per-session
picker that covers it strictly better — and two ways to express one thing is
what produced the collision above. Its whole surface is gone: the toggle, the
`agent-dsh` settings domain, the `AppSettings` key, and the dsh preferences tab
(dsh now shows only its MCP tab, since `PreferencesPage` edits
`~/.claude/settings.json` and never applied to it). A stale key left in an
existing `app-settings.json` is simply ignored — that file is not schema-bound
the way the SQLite tables are.

The tools also renamed in the move (`cordis_run`/`cordis_inspect_self` rather
than `cordis_start`/`cordis_inspect_runs`) — the names depend on how the
composition configures the row, which a bare `ctx.plugin(ToolCordis)` did not.

**The test that should have caught it now exists.** Discovery health is a shape
check — it proves the YAML parses and holds named rows, not that every row's
host service exists — so `cordis` listed as healthy while being unmountable.
`presets.test.ts` now mounts all four.
