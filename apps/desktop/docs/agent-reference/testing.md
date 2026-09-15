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
