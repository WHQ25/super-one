## Testing

Use integration tests for cross-layer behavior (store → IPC → session → backend).
For an isolated parser or reducer defect, a focused unit test can be sufficient.
Reproduce behavior changes before implementing the fix where practical.

### Scope

For behavior changes, reproduce the scenario at the relevant integration boundary,
then implement and rerun affected checks. Documentation and low-impact wording
changes do not need invented behavior tests. The root test-scope policy applies.

### Setup

- **Framework**: Vitest with globals enabled
- **Environment**: `node` by default. Component tests opt into `jsdom` with a `/** @vitest-environment jsdom */` docblock on the file's first line (required — vitest 4 removed `environmentMatchGlobs`, so it is not auto-matched by extension)
- **Setup file**: `apps/desktop/vitest.setup.ts` (imports `@testing-library/jest-dom/vitest`, polyfills ResizeObserver, sets up mocked `window.app`/`window.agent` proxies)
- **Cross-workspace include**: `apps/desktop/vitest.config.ts` adds `../../packages/{shared,ui}/src/**/*.{test,spec}.*` so shared/ui tests run in the same suite
- **Directory layout**:
  - Unit + component-level integration: co-located as `*.test.ts` / `*.test.tsx` next to source (in any workspace)
  - Cross-layer / E2E integration: `apps/desktop/src/test/integration/`, named by scenario (e.g. `permission-flow.test.ts`)
  - Shared fixtures: `apps/desktop/src/test/fixtures/` (extract when used in 2+ files)

### Layers — prefer higher (more integration)

| Layer | What it tests | Mock only | When to use |
|---|---|---|---|
| **Integration (default)** | Multiple real modules collaborating across a user scenario | True external boundaries: Claude SDK subprocess, `window.agent` IPC, `fs`, `child_process`, network | **Most tests** — permission flow, session lifecycle, IPC wire-up, store reducers over multi-step scenarios |
| **Component** | Single React component + user events | `window.agent`, `window.app` | Keyboard shortcuts, focus management, visible UI state |
| **Unit** | Pure function / class in isolation | — | Complex branching logic in utilities (`tool-display.ts`, `claude-permissions.ts`, schema validators) |

### Rules

- **Default to integration**: when adding a feature or fixing a bug, write the test at the highest reasonable layer. Use unit tests when the relevant behavior is isolated, such as parsing, validation, or reduction.
- **Scenario-style naming**: `describe` uses a noun phrase for the scenario (`describe('session cwd switching', ...)`); `it` combines behavior with condition/result (`it('defers rebuild until next send when cwd changes mid-stream', ...)`). Reading the `it` name should surface both trigger and outcome — no given/when/then template required. Prefer scenarios over function names — `it('switches session to acceptEdits after approving plan')` beats `it('setPermissionMode calls backend')`.
- **Mock only at true boundaries**: real `Session`, real Zustand stores, real reducers, real IPC-handler logic. Mock only the Claude SDK subprocess (via `FakeBackend`), `window.agent`/`window.app` in renderer, `fs`, `child_process`, and network. Prefer a higher boundary when mocking an internal module would hide the behavior being verified.
- **Regression test = scenario test**: reproduce the observable failure at the layer where it lived; use integration coverage when the failure crosses layers.
- **Skip trivial forwarding**: don't test `foo.bar(x)` → `api.bar(x)` passthroughs. Test the scenario across the forwarding, not the forwarding itself.
- **Run the smallest sufficient suite**: after implementing, run only what the change can affect — `bunx vitest run <file.test.ts>`, `bunx vitest related <changed-source.ts>`, or `bunx vitest run --changed HEAD` (all from `apps/desktop`). Run the full suite only when explicitly requested; it is not a pre-commit gate. See the test-scope rules in the root `CLAUDE.md`.

### Good examples to follow

- `apps/desktop/src/main/session/session.test.ts` — `FakeBackend` + real `Session`; scenarios like "switch cwd during streaming defers rebuild to next send", "bypass mode boundary triggers backend rebuild"
- `apps/desktop/src/renderer/src/stores/chat-store.test.ts` — real Zustand store + mocked `window.agent`; scenarios like "respondToPlanApproval triggers setPermissionMode IPC when approved"
- `apps/desktop/src/main/session/isolation.integration.test.ts` — multi-session isolation scenarios with fake backends

### Testing desktop as a node on one machine

Run your normal dev desktop as A and a second dev desktop as B, the node:

```bash
bun run dev:cdp                      # A: your usual profile, renderer :5173, CDP :9222
bun run dev:desktop-node:lab         # B: starts and pairs A with it
bun run dev:desktop-node:lab:pair    # pair again (B must be running)
bun run dev:desktop-node:lab:status
bun run dev:desktop-node:lab:stop
```

The product pairs two desktops through a phone. The lab skips the phone: B
mints a node code and A pairs it, both over CDP through development-only IPC
(`SUPERONE_LAB_A_CDP_PORT` if A's CDP is not on 9222). Without A's CDP, B stays
up and `lab:pair` pairs later. A's Control Other Devices tab needs the
experimental remote nodes setting on.

B is `SUPERONE_INSTANCE=node-b` (`scripts/desktop-node-lab.ts`). It runs the
main/preload build already in `apps/desktop/out` (A's `bun run dev` writes it;
the script builds once if it is missing) against its own renderer dev server, so
it never rebuilds A's files. Restart B after A rebuilds main. Ports (override
with `SUPERONE_LAB_NODE_PORT`, `SUPERONE_LAB_CDP_PORT`, `SUPERONE_LAB_RENDERER_PORT`):
node host 7794 (A's dev default is 7793), CDP 9334, renderer 5174.

| | A | B |
|---|---|---|
| Profile (`superone.db`, settings, node identity and pairings) | `.dev-data` | `.dev-data/instance-node-b` |
| SuperOne home (accounts, mini-apps, memory) | `~/.superone/dev` | `instance-node-b/lab/superone-home` |
| Harness runtimes | `~/.superone/dev/harness` | shared with A (`SUPERONE_LAB_HARNESS_HOME`) |
| Harness logins (`~/.claude`, `~/.codex`, Keychain) | `$HOME` | shared (same `$HOME`) |
| Worktrees for children (`~/.worktrees`) | `$HOME` | shared; names do not collide |
| Clones of repositories B lacks | — | `instance-node-b/lab/projects` |
| Dev log, event trace | `dev.log`, `event-trace.db` | `instance-node-b-dev.log`, `instance-node-b-event-trace.db` |

There is no single-instance lock, and the phone LAN server and other local
listeners take ephemeral ports. B's node host starts when it mints a code and
then runs while A is paired; delete `.dev-data/instance-node-b` for a fresh node. A child
on B needs its harness enabled and signed in on B (Settings → Harnesses).

The automated version is `e2e/desktop-node-orchestration.spec.ts`
(`bun run test:e2e:fast -- e2e/desktop-node-orchestration.spec.ts` after
`bunx electron-vite build`). B mints a node code and A pairs it through the same
development-only IPC as the lab, and a parent on A
spawns children on B for a repository served by a loopback `git daemon`. Both
run the scripted harness (`src/main/session/backends/scripted-backend.ts`): every
harness follows the `<scripted>` steps in its message instead of calling a model.
It is enabled only by `SUPERONE_E2E_SCRIPTED_HARNESS=1` in an unpackaged build
(`scripted-harness-gate.ts`); a packaged app ignores the variable.

Native phone acceptance uses `e2e/unified-remote-protocol.live.spec.ts`. It
starts two isolated Electron profiles and pairs two real SDK clients through
the production encrypted pairing flow. The desktops connect to each other
through the Alpha Relay; each phone case runs over both LAN and relay. It
checks native reads, drafts, forms, upload, conditional file writes, project
and Git edits, session lifetime, session/PTY contention, source-desktop
takeover and mid-turn phone transport switching. It also asserts that the
scripted harness never downloads managed Claude or Codex runtimes.

This opt-in test transmits only its own temporary pairing credentials and
synthetic content to `relay-alpha.super-one.dev`. Obtain authorization for
that live destination before running it. After `bunx electron-vite build`,
run from `apps/desktop`:

```bash
SUPERONE_E2E_LIVE_RELAY=1 env -u ELECTRON_RUN_AS_NODE bun run test:e2e:fast -- e2e/unified-remote-protocol.live.spec.ts
```

Clearing `ELECTRON_RUN_AS_NODE` matters when the agent's shell inherited it:
Playwright must launch Electron as an app, not a Node process. The test closes
both apps and removes its profiles and temporary repositories. Its paired SDK
actors exercise the production transport; physical-phone UI smoke is separate.
Every former phone-command family is covered by the local endpoint contracts
under `src/main/node-host/phone-contract`, including provider-specific pending
interactions and MCP App Views. The immutable sender/codec budget gate is
`src/main/stream/wire-baseline.test.ts`; never raise its fixture to accept a
regression.
