# Cursor SDK behavioral contracts

## Exclusive live content sources

- **Behavior:** `onDelta` and `Run.stream()` can describe the same live output.
  SuperOne maps live content from deltas, uses steps for correlated tool detail,
  and disables content emission in the concurrent stream consumer.
- **Observed:** Current 1.0.30 adapter.
- **Depends on it:** `packages/cursor/src/cursor-runtime.ts`, `cursor-event-map.ts`.
- **Guard:** Runtime and event-map tests.

## Local store and prewarm identity

- **Behavior:** Local create/resume use an explicit workspace store. Workspace
  prewarm options must match the execution plan, including credentials, settings,
  sandbox, MCP and auto-review; a mismatched plan does not warm that executor.
- **Observed:** Current 1.0.30 local-session/prewarm adapter.
- **Depends on it:** `cursor-local-options.ts`, `cursor-workspace-prewarm.ts`.
- **Guard:** Local-options, workspace-prewarm and store tests.

## SDK helper lookup under Electron

- **Behavior:** SDK helper discovery can miss platform packages when argv points
  at a flag or app.asar. Resolve matching assets and unpacked paths explicitly;
  preserve executable permissions.
- **Observed:** Current 1.0.30 adapter and platform tests.
- **Depends on it:** `cursor-platform-binaries.ts`.
- **Guard:** `cursor-platform-binaries.test.ts`; packaged execution is separate.

## Login stores have separate lifetimes

- **Behavior:** SDK login mints a key and stores SDK auth state; desktop copies
  the key into its vault. SDK logout alone does not remove the vault copy.
- **Observed:** `cursor-sdk-auth.ts` and desktop auth IPC handlers at pin 1.0.30.
- **Depends on it:** Credential settings and session rebuild flow.
- **Guard:** Source-level contract; combined logout behavior has no asserted
  product guarantee here.

## Fork and context claims

- **Behavior:** The adapter's weak fork creates a blank provider agent, so it
  cannot advertise transcript fork. Context occupancy and model window are
  separate from cumulative usage; a missing window is not a fabricated limit.
- **Observed:** Current backend, fork adapter and model/event mapping.
- **Depends on it:** `cursor-fork.ts`, `cursor-backend.ts`, shared capabilities.
- **Guard:** Fork, context/model mapping and backend tests.
