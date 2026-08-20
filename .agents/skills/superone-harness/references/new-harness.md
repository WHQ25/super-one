# Adding a New Harness — Phased Roadmap

Read `SKILL.md` first. This file is the ordered plan; `experiences.md` is the per-feature detail you
pull in during P3–P4.

## Contents

- [Gate 0: is this actually a new harness?](#gate-0)
- [P0 — Identity (contract layer)](#p0)
- [P1 — One turn end-to-end (runtime layer)](#p1)
- [P2 — Interaction loop (HITL)](#p2)
- [P3 — Chat bar parity (presentation layer)](#p3)
- [P4 — Settings, install, ops](#p4)
- [P5 — Periphery: remote node, packaging, mobile](#p5)
- [Design pack convention](#design-pack)

---

<a id="gate-0"></a>
## Gate 0: is this actually a new harness?

Three different things get called "adding a provider". Picking wrong costs weeks.

| The thing you're adding | It's a… | Where the work goes |
|---|---|---|
| A different **model endpoint** for an existing harness (NVIDIA, a proxy, a custom OpenAI-compatible URL) | **API provider / credential** | Provider dialog + `sessions.api_provider_id` (which holds a *credentialId*) + `resolveService(consumer, { credentialId })`. **Zero** harness work. |
| An agent that already **speaks ACP** | **New ACP agent id** | `apps/desktop/src/main/acp/agent-catalog.ts` + brand helpers in `packages/shared/src/harness/acp-brand.ts`. Reuses the whole `acp` backend. ~10 files, not 150. |
| A CLI/SDK with its **own protocol and session model** | **New harness** | This document. |

Ask explicitly before starting. "Support Grok" was an ACP agent; "support Cursor" was a harness.
If you can get a working turn out of the provider by pointing an existing backend at it, you do not
have a harness.

---

<a id="p0"></a>
## P0 — Identity (contract layer)

**Goal:** the id exists everywhere the compiler can see, and a session row can be created with it.
No behaviour yet.

Do this in one commit and let type errors drive you. Start with `HarnessResourcesMap`.

| File | What to add |
|---|---|
| `packages/shared/src/agent-types.ts` | `XxxResources` interface + key in `HarnessResourcesMap` + key in `StartupData.cached` |
| `packages/shared/src/session-provider-definitions.ts` | base `SessionProvider` entry; its exhaustive `Record<HarnessId, …>` must stay compiler-complete |
| `packages/shared/src/harness/harness-capabilities.ts` | entry in `HARNESS_CAPABILITIES` — **all false** except `displayName` until each is actually wired |
| `packages/shared/src/harness/harness-brand.ts` | `HARNESS_DEFAULT_BRAND_HUE` + `HARNESS_DEFAULT_TOKENS` entries |
| `packages/shared/src/agent-types.ts` | **`AppSettings['agentPreference'].<harness>` slot** — `BrandOnlyAgentPreference` when the harness stores nothing else — plus the matching optional key on `SaveAppSettings`. Every harness needs one; see the trap in `SKILL.md` |
| `apps/desktop/src/main/session/harness-registry.ts` | config zod schema + `Harness` object + registry map entry |
| `apps/desktop/src/main/session/backends/xxx-backend.ts` | `SessionBackend` skeleton — required members only, throw/no-op bodies |
| `apps/desktop/src/main/session/backends/xxx-fork.ts` | `forkTranscript` stub (can throw "not supported" initially) |
| `apps/desktop/src/main/session/session-repo.ts`, `db-sessions.ts`, `database-migrations.ts` | seed/read the base provider, persist its id, and derive the Harness id; migrate aliases when renaming an id |
| `apps/desktop/src/renderer/src/stores/app.ts` | `brandHues` / `tokenOverrides` records — in the initial state, in `loadBrandHues`, **and in the `onAppSettingsChange` handler**. The last one is the trap: it rebuilds both records wholesale, so a harness left at a hard-coded `null` there is reset on every settings broadcast |
| `apps/desktop/src/renderer/src/stores/chat-store/helpers/agent-defaults.ts` | default model/effort branch |
| `apps/desktop/src/renderer/src/stores/chat-store/harness/xxx-handler.ts` + `harness/index.ts` + `chat-store/index.ts` | `HarnessHandler` — `connect()` may return an empty bundle |
| `apps/desktop/src/renderer/src/components/sidebar/BrandColorPopover.tsx` | `HARNESS_LABEL` entry |
| `apps/desktop/src/renderer/src/lib/session-menu-items.ts` | menu entry so a session can be created at all |
| `apps/desktop/src/main/app-settings-service.ts` | `defaults.agentPreference.<harness>`, a `readBrandOnlyPreference(data, '<harness>')` call in **both** assembly sites, and a spread in the save-merge branch; plus accept the id in suggestion/default/secondary parsing and `harnessOrder` validation — those are hard-coded allowlists and do not fail typecheck |
| `apps/cli/src/session/harness-runners.ts` | `createHarnessRunner` case — a simulated runner is fine and satisfies the `never` guard |

**Acceptance:** `bun run typecheck` is green, both desktop and runtime/CLI databases contain the
base provider row, and you can create a session on the new harness from the UI without a
`SessionProvider not found` error (it just won't answer).

---

<a id="p1"></a>
## P1 — One turn end-to-end (runtime layer)

**Goal:** type a message, see streamed text, see the turn finish.

Put provider-specific code in its own main-process folder (`apps/desktop/src/main/<harness>/`),
mirroring `codex/`, `cursor/`, `acp/`. Keep the backend a thin state machine over it.

| Module | Responsibility | Model to copy |
|---|---|---|
| `<harness>-runtime.ts` | resolve binary / construct SDK client, spawn or connect, lifecycle | `cursor-runtime.ts`, `codex/app-server-client.ts` |
| `<harness>-auth.ts` | credentials, keychain read/write, auth status | `cursor-auth.ts` |
| `<harness>-event-map.ts` | **provider payload → `AgentEvent`** — the single highest-value module | `cursor-event-map.ts`, `packages/claude/src/agent-event-mapper.ts` |
| `xxx-backend.ts` | implement `SessionBackend`: `start/rebuild/send/interrupt/close`, emit via `onEvent` | `claude-backend.ts` (most complete) |

Write the event mapper **test-first**, table-driven over real recorded provider payloads. It is the
one place where a table test genuinely beats an integration test, because the input is a fixed wire
format and the output is a fixed union. See `references/event-contract.md` for the minimum event set.

Also touch:
- `apps/desktop/src/main/index.ts` — IPC handlers for anything the renderer needs (auth status, model list)
- `apps/desktop/src/preload/index.ts` + `index.d.ts` — expose those handlers
- `apps/desktop/src/main/agent/agent-service.ts`, `session/session.ts`, `session-manager.ts` — only if the harness needs a hook that doesn't exist yet

**Acceptance:** send "hi", get streamed assistant text, `message_complete` fires, the session
persists and resumes after restart.

---

<a id="p2"></a>
## P2 — Interaction loop (HITL)

**Goal:** the agent can ask for something and the user can answer.

Everything here is `SessionBackend` members plus event mapping — no new UI, because the chat already
renders these once the events arrive. That's the payoff of the shared `AgentEvent` union.

- `permission_request` → `respondToPermission()` round trip
- `plan_approval` → `respondToPlanApproval()`
- `ask_user_question` → `respondToQuestion()` / `dismissQuestion()`
- `interrupt()` and `getPendingInteractions()` (needed for resume/replay to not lose a pending prompt)
- `dequeueMessage()` + `queued_message_consumed` if the provider supports queuing mid-turn

If the provider has no native permission protocol, decide deliberately whether to synthesize one or
to report `supportsPlanMode: false` — a fake approval prompt that doesn't actually gate the tool call
is worse than no prompt.

**Acceptance:** a tool call triggers the permission popover, approving it continues the turn,
denying it stops it, and interrupt mid-stream leaves a clean transcript.

---

<a id="p3"></a>
## P3 — Chat bar parity (presentation layer)

**Goal:** every control in the chat bar is either correct or deliberately absent.

This is where the silent enumerations live. Work through `experiences.md` row by row —
model/effort, permission modes, sandbox, context usage, slash commands, mentions, placeholder,
session icon, suggestion ordering, and order persistence. Do not skip the "deliberately absent"
half: `sandboxHarness.ts` returning `false` is a real deliverable, not a gap.

Placeholder and slash-command dispatch must contain an explicit entry for the harness through their
`Record<ChatProvider, ...>` maps. Add localized ask/plan copy even when plan mode is currently hidden,
and register an explicit empty slash catalog when commands are unsupported. Never use Claude as the
fallback for either surface.

Flip `HARNESS_CAPABILITIES` flags to `true` **as each one lands**, not up front.

**Acceptance:** walk the chat bar left to right on the new harness; nothing is missing, inert, or
showing another harness's vocabulary.

---

<a id="p4"></a>
## P4 — Settings, install, ops

**Goal:** a user who has never used this harness can discover, enable, authenticate, and see usage.

| Surface | Files |
|---|---|
| Install catalog / enable-disable | `packages/shared/src/environment/harness-installation.ts` (`NodeHarnessId`, `NODE_HARNESS_DEFINITIONS`), `apps/desktop/src/main/harness/{host,scan-cli,resolve-runtime,resource-cache}.ts`, `packages/runtime/src/harness/{enable,runtime-ready}.ts` |
| Settings pages | `HarnessesSettingsPage.tsx` (`CATALOG_HARNESS_META` must cover every `NodeHarnessId`), `AppSettingsPage.tsx`, a `<Harness>AuthSettings.tsx` if auth is non-trivial |
| Ordering persistence | `apps/desktop/src/main/app-settings-service.ts` (`HARNESS_IDS`, `parseSuggestionHarnessKey`, `readHarnessOrder`) + `app-settings-service.test.ts`; verify save/read preserves the new key |
| Brand persistence | Covered by the `it.each(Object.keys(HARNESS_DEFAULT_BRAND_HUE))` invariant in `app-settings-service.test.ts` — it fails the moment a harness id has no `agentPreference` slot, so adding the id to `HARNESS_DEFAULT_BRAND_HUE` is enough to be told |
| Visibility gating | `renderer/src/lib/harness-visibility.ts` — **fails closed**, so this is what makes the harness appear at all |
| Usage & cost | `apps/desktop/src/main/usage-stats-service.ts` (`HarnessKind`, provider→kind mapping), `UsagePage.tsx`, `usage-model-presentation.ts` |
| i18n | `packages/shared/src/i18n/{en,zh}.ts` — both, always |
| Onboarding | `components/onboarding/OnboardingDiscover.tsx` |
| Fork / rewind | real `forkTranscript` + `rewindFiles` |
| Automation | `apps/desktop/src/main/mcp/automation-tools.ts` run-config type + `AutomationDialog.tsx` |

**Acceptance:** fresh profile → Settings → Harnesses shows the harness, enabling + authenticating it
makes it appear in the session picker, drag it to a new rank and reopen the page/app without the
order reverting, and verify a completed turn shows up on the Usage page.

---

<a id="p5"></a>
## P5 — Periphery: remote node, packaging, mobile

Optional for a first ship — state that explicitly rather than silently deferring it.

- **Remote node / CLI**: `apps/cli/src/session/{harness-cli,harness-enable,harness-host,harness-runners}.ts`, `packages/runtime/src/session/session-provider-store.ts`, and a real (non-simulated) runner in `packages/<harness>/`. Seed the same shared base SessionProvider catalog used by desktop. The simulated runner must never be reachable in production — `createAcpOpenCodeProductionRouter` gates it behind an explicit opt-in for exactly this reason.
- **Packaging**: `apps/desktop/electron-builder.yml`, `build/afterPack.cjs` if the harness ships platform binaries. Managed runtimes download on demand under `~/.superone/harness` instead — prefer that (see `docs/design/harness-hot-swap.md`).
- **Mobile**: events reach mobile through the shared `AgentEvent` stream, so most of it is free. Check `stripContentBlock` truncation if the harness emits rich tool payloads.
- **Package extraction**: moving provider code into `packages/<harness>/` is what makes the CLI able to use it. Do it when P5 starts, not before — Cursor extracted at commit 4 of 7.

---

<a id="design-pack"></a>
## Design pack convention

Before P0 on a non-trivial harness, write `docs/design/<harness>-sdk-harness.md` recording the
**locked decisions** — which SDK/protocol, which auth mode, which session store, what's explicitly
out of scope — plus a `README-<harness>-harness.md` index. `docs/design/cursor-sdk-harness.md` is
the model (decisions labelled D1–D8, referenced from commit messages).

This matters more than usual here because harness integrations span many sessions and many files;
without the locked-decision list, later phases silently re-litigate choices made in P1.
