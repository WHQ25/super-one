# DeepSeek harness behavioral contracts

## One Cordis module identity

- **Behavior:** External plugins must resolve the same `@deepseek-ai/*` module
  instances as the host. A duplicate Context breaks service injection. Plugin
  roots must be realpath-normalized before resolution hooks match importers.
- **Observed:** 0.1.7-rc.1 through 0.2.2-rc.1 adapter/resolver; Cordis 4.1.0.
- **Depends on it:** `packages/deepseek/src/plugin-host/resolver.ts`.
- **Guard:** `plugin-host/resolver.test.ts`, `plugin-host/wiring.test.ts`.

## Loader service access and activation

- **Behavior:** Undeclared injected service-property access can throw; optional
  services use `ctx.get`. A returned service proxy is bound to the consuming
  context. Prefer Loader entry creation over invoking its import primitive from
  an unrelated context. Await Loader before installing its group builtin.
  Activation failure must be checked through entry state, not just rejection.
- **Observed:** Cordis 4.0.4 through 4.1.0 / Loader 1.0.5 through 1.1.0; the
  non-rejecting activation change is recorded in the 0.1.7-rc.1 upgrade.
- **Depends on it:** `tree.ts`, `cordis-loader.ts`, `mcp-servers.ts`, plugin host.
- **Guard:** `mcp-servers.test.ts`, `plugin-host/mount.test.ts`, `presets.test.ts`.

## Session cwd and delegated effects

- **Behavior:** Shared executors resolve workspace from the calling session.
  Child effects must find their top-level host owner through session ancestry.
  In 0.2.2-rc.1, the working-directory service owns the effective directory,
  while the immutable session header retains the original directory.
  Subagent lifecycle notifications carry child/run identity rather than the
  launching tool call; the bridge carries call/parent identity in
  AsyncLocalStorage. New child IDs are returned immediately; they do not imply
  that the child's first turn has finished.
- **Observed:** 0.1.7-rc.1 through 0.2.2-rc.1 bridge; 0.2.2-rc.1 working-directory
  and immediate child activation source.
- **Depends on it:** `runtime.ts`, `tool-plane.ts`.
- **Guard:** `subagent.test.ts`, `subagent-diagnostic.test.ts`, `tool-plane.test.ts`.

## Preset realms and persistence

- **Behavior:** Compaction and plan services belong to the selected preset's
  realm. Durable header/projection selects the preset on resume; a later draft
  default must not replace it. A preset can shadow deployment persona text.
- **Observed:** Declaration-row presets in 0.1.7-rc.1 through 0.2.2-rc.1.
- **Depends on it:** `presets.ts`, `runtime.ts#compactSession`.
- **Guard:** `presets.test.ts`, `resume.test.ts`, `compaction.test.ts`.

## Log ordering and trajectory

- **Behavior:** Request headers arrive after step start; turns and steps are
  1-based. Live assistant frames are process-local, while committed messages
  are durable. Empty provider history is distinct from a failed read.
- **Observed:** 0.1.7-rc.1 through 0.2.2-rc.1 trajectory/runtime. In 0.2.2-rc.1,
  log reads use the public immutable `Session.snapshotEvents()` API. The tagged
  source already exposed that API before this upgrade; it is not a newly
  introduced capability.
- **Depends on it:** `event-map.ts`, `stored-session.ts`, `trajectory/`.
- **Guard:** Mapper and trajectory tests, including memory/disk round trips.

## Sandbox assertions need a positive control

- **Behavior:** A rejected tool schema can prevent a write before the sandbox
  runs. Workspace-write also permits platform temporary directories, so a
  sibling temp path is not a reliable forbidden target.
- **Observed:** `sandbox.test.ts` against the mounted dsh executors.
- **Depends on it:** Sandbox verification, not a new product permission.
- **Guard:** A valid call, an outside-home target and the full-access twin.

## Prepared-step model selection

- **Behavior:** The agent captures its model choice before prompt assembly and
  pre-step processing and retains that choice across retries. `agent/request`
  cannot replace provider, model or effort. Changes must use the complete
  durable `agent.model.select()` value and affect a future step. A resumed
  session's recorded choice takes precedence over creation-option fallbacks.
- **Observed:** 0.2.2-rc.1 agent model-selection and agent-loop source.
- **Depends on it:** `runtime.ts#setRoute`, `runtime.ts#imageBlocksFor`.
- **Guard:** `model-selection.test.ts`, `resume.test.ts`, `images.test.ts`.

## Independent forks and exact inherited cuts

- **Behavior:** `SessionHeader.isSeeded` marks inherited history, and the exact
  inherited prefix travels separately as `inheritedEventCount` when persistence
  creates the session. A new plain conversation fork omits `parentSession`,
  `origin` and delegation depth: these describe delegated children. Historical
  ordinary forks may retain a source in `parentSession`; presence of that field
  alone does not classify a session as a child.
  Forked logs remain v4; this metadata change does not call for a host format bump.
- **Observed:** 0.2.2-rc.1 session/persistence storage contract and fork source.
- **Depends on it:** `runtime.ts#forkSession`.
- **Guard:** `fork.test.ts`, `resume.test.ts`.

## Required service and executor composition

- **Behavior:** Session-projection registration is asynchronous; domain services
  await registration before using their retained projection handles. The tool
  registry no longer chooses execution mode itself. Mount the default native
  executor on the host plane and let a PTC composition select its scoped PTC
  executor. A missing mandatory service can leave a dependent Cordis row waiting
  instead of throwing during tree construction.
- **Observed:** 0.2.2-rc.1 tools, executors and session-projection source; upstream
  presets use the PTC executor row.
- **Depends on it:** `tree.ts`, `tool-plane.ts`, vendored preset declarations.
- **Guard:** `runtime.test.ts`, `presets.test.ts`, `tool-plane.test.ts`,
  `bundled-plugins.test.ts`.

## Runtime and PTC launch requirements

- **Behavior:** dsh 0.2.2-rc.1 requires Node 24.9 or newer. Its Node PTC control
  protocol uses birpc and must be upgraded with its runtime/bootstrap together.
  Inside Electron, a subprocess runner must start as Node rather than launching
  another app instance; its target command receives a separately built environment.
- **Observed:** 0.2.2-rc.1 package engines, PTC runtime and subprocess runner source.
- **Depends on it:** Both dependency manifests, subprocess patch,
  `apps/desktop/src/main/deepseek/deepseek-ptc-launcher.ts`.
- **Guard:** Runtime/tool tests and `deepseek-ptc-launcher.test.ts`; packaged
  Electron and Windows execution remain live verification requirements.

## Existing JSONL root keeps its physical encoding

- **Behavior:** Both the previous published 0.1.7-rc.1 JSONL backend and the latest
  published backend default to checksummed Zstandard frames. SuperOne explicitly
  retains `compression: 'zstd'` and the `.jsonl.zstd` generation artifacts.
  The backend refuses a root containing artifacts of the opposite configured
  encoding; changing the setting is not an in-place migration.
- **Observed:** Published 0.1.7-rc.1 and 0.2.2-rc.1 JSONL config/runtime;
  `encodingMismatch` requires a matching mode or a separate root.
- **Depends on it:** `tree.ts#createDeepseekTree` persistence configuration.
- **Guard:** `resume.test.ts` resumes/appends the unchanged old-published
  `fixtures/dsh-0.1.7-rc.1/session.v4.jsonl.zstd` artifact.

## Working directories must exist before dispatch

- **Behavior:** The working-directory service validates directories during prompt
  assembly, before a model request. If the effective directory vanished it can
  recover the original project; when that too is missing the turn fails before
  dispatch. A synthetic absolute cwd that older tests never accessed is no longer
  an adequate session fixture.
- **Observed:** Published 0.2.2-rc.1 `WorkingDirectoryService.ensure` and runtime.
- **Depends on it:** `tool-plane.ts`, all runtime tests constructing sessions.
- **Guard:** Runtime/preset/tool/compaction tests use real repository or temporary
  directories.

## API-key provider and official capacity overrides

- **Behavior:** `dsh-llm-deepseek` now exports protocol/configuration primitives;
  the mountable API-key plugin is `dsh-llm-deepseek-api-key`, which resolves its
  credential reference per operation and registers `deepseek-official`.
  Generic context fallback is decimal 1,000,000; both official models advertise
  1,048,576 and the host's explicit catalog must carry that value rather than
  accidentally replacing official metadata with the custom-model fallback.
- **Observed:** Published 0.2.2-rc.1 API-key config, DeepSeek built-in models and
  defaults. Default output cap is 256,000 before request/model overrides.
- **Depends on it:** `tree.ts#deepseekAdapterPlugin`,
  `apps/desktop/src/main/deepseek/deepseek-runtime-host.ts`.
- **Guard:** `credentials.test.ts`, `deepseek-runtime-host.test.ts`,
  `deepseek-credentials.test.ts`; actual API dispatch still needs a live smoke.
