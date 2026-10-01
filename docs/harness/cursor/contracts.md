# Cursor SDK behavioral contracts

## Local MCP restrictions and compatibility routing

- **Behavior:** Session sandbox requests reach SDK `local.sandboxOptions.enabled`.
  MCP permission checks can fail closed in sandbox/auto-review runs. Separately,
  authenticated SDK dashboard services read team admin MCP/network controls and
  can start stdio servers through `buildMcpSandboxPolicy` / `spawnInSandbox`,
  even when the session filesystem sandbox is disabled.
- **Observed:** SDK 1.0.30 installed `dist/esm/357.js` (`DefinitionMcpLoader`,
  team settings service and local executor initialization); `options.d.ts`
  documents the fail-closed MCP behavior. Team settings come from internal
  `getTeamAdminSettingsOrEmptyIfNotInTeam`, cached in a `settingsPromise` for
  300000 ms, and a feature gate participates in policy selection.
- **Depends on it:** Desktop compatibility discovery is skipped when sandbox is
  requested, before any stdio spawn. Existing compat clients are closed and
  servers stay in the native list. Session settings override config settings,
  matching the core adapter; requests still skip compat if SDK platform support
  would later disable the sandbox.
- **Detection limit:** SDK package exports and public declarations expose no
  team/MCP policy query or service injection. `Cursor.me()` / `SDKUser` do not
  report team membership or controls, and SuperOne's account resources cannot
  establish that restrictions are absent. No durable team-policy cache was
  found. Team controls therefore remain an unresolved compatibility release
  gate; disabling the session sandbox is not proof that rerouting is permitted.
- **Guard:** Desktop `cursor-runtime.test.ts` checks create/prewarm, existing
  client cleanup, native list restoration, and setting precedence. Team-policy
  detection has no supported API or asserted guarantee.

## MCP App compatibility results

- **Behavior:** SDK 1.0.30's MCP client sends `{name, arguments}` without the
  harness call id, and returns only `{content, isError}` from MCP tool calls.
  `structuredContent` and private `_meta` do not reach the model/SDK events.
- **Observed:** Installed `dist/esm/357.js`, `McpSdkClient.callTool`; exercised
  through the real Cursor event mapper with a stdio fixture result.
- **Depends on it:** Desktop `mcp-apps/compat-session.ts` and `compat-records.ts`.
  The first text block carries the host record id; the View reads original
  structured/private data from that record. The model gets a bounded text
  summary of structured output.
- **Guard:** Desktop `compat-session.test.ts` and `compat-records.test.ts`.

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
