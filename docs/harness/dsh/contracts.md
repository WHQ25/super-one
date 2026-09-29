# DeepSeek harness behavioral contracts

## One Cordis module identity

- **Behavior:** External plugins must resolve the same `@deepseek-ai/*` module
  instances as the host. A duplicate Context breaks service injection. Plugin
  roots must be realpath-normalized before resolution hooks match importers.
- **Observed:** Current 0.1.7-rc.1 adapter and resolver implementation.
- **Depends on it:** `packages/deepseek/src/plugin-host/resolver.ts`.
- **Guard:** `plugin-host/resolver.test.ts`, `plugin-host/wiring.test.ts`.

## Loader service access and activation

- **Behavior:** Undeclared injected service-property access can throw; optional
  services use `ctx.get`. A returned service proxy is bound to the consuming
  context. Prefer Loader entry creation over invoking its import primitive from
  an unrelated context. Await Loader before installing its group builtin.
  Activation failure must be checked through entry state, not just rejection.
- **Observed:** Current Cordis adapter; the non-rejecting activation change is
  recorded in the 0.1.7-rc.1 upgrade.
- **Depends on it:** `tree.ts`, `cordis-loader.ts`, `mcp-servers.ts`, plugin host.
- **Guard:** `mcp-servers.test.ts`, `plugin-host/mount.test.ts`, `presets.test.ts`.

## Session cwd and delegated effects

- **Behavior:** Shared executors resolve workspace from the calling session.
  Child effects must find their top-level host owner through session ancestry.
  The subagent lifecycle emitter does not supply the declared parent argument
  to listeners; the bridge carries call/parent identity in AsyncLocalStorage.
- **Observed:** Current 0.1.7-rc.1 runtime bridge and tests.
- **Depends on it:** `runtime.ts`, `tool-plane.ts`.
- **Guard:** `subagent.test.ts`, `subagent-diagnostic.test.ts`, `tool-plane.test.ts`.

## Preset realms and persistence

- **Behavior:** Compaction and plan services belong to the selected preset's
  realm. Durable header/projection selects the preset on resume; a later draft
  default must not replace it. A preset can shadow deployment persona text.
- **Observed:** Current declaration-row presets in 0.1.7-rc.1.
- **Depends on it:** `presets.ts`, `runtime.ts#compactSession`.
- **Guard:** `presets.test.ts`, `resume.test.ts`, `compaction.test.ts`.

## Log ordering and trajectory

- **Behavior:** Request headers arrive after step start; turns and steps are
  1-based. Live assistant frames are process-local, while committed messages
  are durable. Empty provider history is distinct from a failed read.
- **Observed:** Current 0.1.7-rc.1 trajectory fold and runtime tests.
- **Depends on it:** `event-map.ts`, `stored-session.ts`, `trajectory/`.
- **Guard:** Mapper and trajectory tests, including memory/disk round trips.

## Sandbox assertions need a positive control

- **Behavior:** A rejected tool schema can prevent a write before the sandbox
  runs. Workspace-write also permits platform temporary directories, so a
  sibling temp path is not a reliable forbidden target.
- **Observed:** `sandbox.test.ts` against the mounted dsh executors.
- **Depends on it:** Sandbox verification, not a new product permission.
- **Guard:** A valid call, an outside-home target and the full-access twin.
