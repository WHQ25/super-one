# DeepSeek harness integration

SuperOne embeds dsh's Cordis tree in the host process. The canonical harness ID
and event `providerId` are `dsh`; DeepSeek remains the product/provider name.
The [integration index](README.md) owns exact package pins and upgrade history.
This document describes the running composition, with implicit upstream behavior
in [contracts](contracts.md) and unused capabilities in [backlog](backlog.md).

## 1. Integration boundary

`packages/deepseek` owns the engine bridge, event projection, tool plane,
persistence, presets and plugin host. Desktop `main/deepseek/` supplies paths,
credentials and settings; `session/backends/deepseek-backend.ts` adapts the runtime
to `SessionBackend`. Renderer code consumes shared types and `AgentEvent`, never
imports dsh runtime packages.

The in-process route gives SuperOne direct cancellation, streaming and approval
seams. The rejected ACP/SDK-subprocess designs and their original experiments
remain in git history; their old capability tables are not current upstream
API documentation.

## 2. Context and session ownership

One lazily initialized Context hosts multiple agents. Each agent has its own
session ID, cwd, selected preset, model and durable event log. The bridge resolves
calls through the invoking agent's session, not a global current-project value.
Optional services are accessed through `ctx.get`; injected property access has
stricter Cordis requirements described in [contracts](contracts.md).

## 3. Runtime composition

`tree.ts` is the composition source. Host-plane services include session
projections, model/tool/agent registries, Loader and its group builtin,
approvals, persistence, attachment storage, retry/image recovery, sandboxed
executors, PTC, subagent providers, jobs, skill/goal/web/command registries,
permission presets, token meter and dynamic-Cordis services.

Model-facing tools and persona live in agent presets. The four vendored
`standard`, `minimal`, `ptc` and `cordis` patch declarations are under
`apps/desktop/resources/agent-presets/`, shipped through `extraResources`.
`presets.ts` uses upstream patch semantics and keeps nested `!!js` expressions
unevaluated until the owning row activates. This is reviewed executable
composition, not arbitrary UI configuration.

## 4. Host integration

Desktop runtime accessors distinguish creating a runtime from peeking at one.
Ambient settings/MCP changes use `peekDeepseekRuntime()` so editing configuration
does not boot an unused harness. Persistence and attachment roots are explicit
SuperOne-owned directories; leaving the attachment home unset would put images
under upstream's default home.

The model adapter and credential plugin receive SuperOne bindings. The app does
not mount dsh's local credential files, full web application or client UI.

## 5. Design decisions

The D labels remain stable because code comments cite them.

| ID | Current decision |
|---|---|
| D1 | Embed the tree in the host process; process isolation remains an optional future architecture change. |
| D2 | Share one tree, with a scoped agent and durable log per session. |
| D3 | SuperOne owns boot/configuration. Use Loader and vendored preset declarations, without booting the upstream profile/web application. The original manual-spine-only design is superseded. |
| D4 | Put engine vocabulary and event/interaction adaptation in `packages/deepseek`; keep the desktop backend as the session facade. |
| D5 | Display dsh permission-preset semantics through shared `PermissionMode` carriers and SuperOne interaction UI. |
| D6 | Executors/services are host-plane; model-facing rows are preset-plane. SuperOne built-ins use native tools, and third-party MCP uses dsh's MCP registrar. |
| D7 | Models and credentials are supplied by SuperOne. |
| D8 | Use upstream durable sessions, explicit resume and completed-prefix fork. |
| D9 | Runtime plugins use the reviewed plugin-host registry and trust boundary; self-modifying Cordis tools are selected through the `cordis` preset. |

## 6. Events and interactions

`event-map.ts` maps durable messages, tool calls/results, todos, usage, retries and
compaction into shared events. Live text and tool input come from process-local
`agent/assistant-stream` frames. Abandoned attempts retract their provisional
content; old `assistant/chunk` log examples do not describe the current format.

Canonical tool names (`Read`, `Write`, `Edit`, `Bash`, `Glob`, `Grep`, `TodoWrite`,
`Task`) reuse the existing renderers. Shell workspace changes are projected into
edit/write/delete rows before turn completion, even when no file tool ran.

The host-plane pre-execute gate resolves a child call to its owning SuperOne
session by walking durable ancestry. An unowned effect is refused. Read-only
calls and delegation can pass without duplicating the approval of their actual
effects. Host-owned tool admission still leaves executor confirmation intact.

`user-questions/request` routes ordinary questions and `plan-review` intent to
the shared question/plan UI. Plan mode combines read-only permission with the
preset's separate plan state; successful approval returns to the default mode.
Mid-turn user input is queued; steer uses `agent.steer()` at a step boundary.

## 7. Persistence, resume and fork

`stored-session.ts` reads the handle-based session store, including migrated old
logs. Fork copies a contiguous prefix ending at a completed turn, creates the
child log through persistence handles and appends the inherited events. Provider
session IDs remain distinct from SuperOne session IDs.

Preset identity comes from `SessionHeader.agentPreset` and the
`agent-preset/selected` projection. A draft setting cannot override a resumed
session's durable selection. Switching presets is allowed only before a turn
has opened. Erroring preset rows remain visible with their failure reason.

## 8. Permission presets and sandbox

| Displayed preset | Shared carrier | Sandbox | Approval |
|---|---|---|---|
| Read-only | `plan` | read-only | ask |
| Workspace write | `default` | workspace-write | ask |
| Full access | `bypassPermissions` | danger-full-access | never |

`permission-presets.ts` maps other shared modes to the default without offering
them as distinct dsh modes. Selecting a preset writes sandbox/approval policy
into the session log, so it survives resume and does not change sibling sessions.
Plan collaboration state is controlled separately through `setPlanMode`.

Both filesystem and shell executors use the per-call sandbox policy. The shell
uses the platform runner; the filesystem wrapper applies path containment.
They must stay aligned. Sandbox unavailability fails closed instead of silently
running unconfined. The preset owns confinement; a second independent sandbox
toggle would contradict it.

PTC executes through a fresh Node process with a scrubbed environment. Desktop
provides its Node launcher; platform-specific verification limits belong in the
upgrade record and backlog.

## 9. Delegation and background work

Spawn and fork providers are mounted. `tools/execute` opens an AsyncLocalStorage
span carrying the delegation call ID, description and parent session ID; this
correlates overlapping child starts safely. Nested foreground output is stamped
with `parentToolUseId` in the parent's open message. Child todos do not overwrite
the parent's todo panel; child usage is `subagent_usage`.

Continuable/background delegation is enabled. Work becomes background when the
launching call returns while it is still running. Live children and jobs emit
`task_*` events, and background child output stops appending to the parent's
active message. Row Stop, session Stop, archive and disposal stop the applicable
work. Background workflows are tracked/stopped but do not yet have a matching
Workflow row in the status-bar list.

Per-child model selection is a host opt-in configured through a Loader entry.
A changed default applies to new sessions; running sessions keep their recorded
policy. Do not restore the old foreground-only patch when re-copying presets.
The current vendored deviation removes `tool-plugin-manager`, which needs an
upstream profile SuperOne does not mount.

## 10. Verification

Use the focused runtime, mapper, preset, permission, subagent/background,
compaction, persistence, trajectory and plugin-host tests under
`packages/deepseek/src`, plus the affected desktop backend/settings checks.
`bundled-plugins.test.ts` checks that composition packages are pinned and that
vendored deviations survive a refresh.

The historical [spike](deepseek-harness-spike.mjs) records the original embedding
experiment; maintained runtime tests are the current upgrade gate. Scripted
adapter tests are not evidence of a live DeepSeek API turn or every packaged
platform. The [upgrade record](upgrades/0.1.7-rc.1.md) names those limits.

## 11. Version and risk strategy

Pin the complete `@deepseek-ai/dsh-*` family exactly and upgrade it together in
`packages/deepseek` and desktop manifests. Related Cordis packages have their
own exact compatible versions; they do not all share the dsh version number.
Use a concrete version, not an assumed npm dist-tag. Refresh declarations and
bundled plugin manifests, inspect upstream surface changes, and record outcomes
under `upgrades/` using the common [harness workflow](../README.md).

Dynamic plugins must share the host's module identity and satisfy its peers.
Loader activation failure can be represented as entry state rather than a
rejected promise; `cordis-loader.ts#entryFailure` checks it explicitly.

## 12. Persona and composition policy

### 12.1 Persona

The deployment retains dsh's identity and adds SuperOne guidance through the
persona prefix. A preset's own persona can shadow that value; inspect the
selected preset's assembled prompt rather than assuming deployment text wins.
The tree/runtime-host comments refer to this boundary.

### 12.2 Self-modifying tools

Dynamic-Cordis runner/inspection services are host-plane and mount once. The
`cordis` preset owns the model-facing tool rows. The former `dshToolCordis`
settings toggle is not the product control. Dynamic code runs in the host
process and can affect other sessions; it is not a security sandbox.

## 13. Loader and MCP updates

MCP entries use sanitized server-name identity (`mcp-<name>`) and Loader updates,
not manual dispose/remount for every config edit. `sync()` is awaited. MCP
configuration watching is debounced, watches the directory to survive atomic
editor saves, and creates that directory before arming the watcher. It does not
boot a runtime in response to an ambient file edit.

The shared mount uses the most recently tracked session cwd for stdio servers;
it is not a per-project MCP instance. Preserve that limitation when describing
multi-session isolation.

## 14. Compaction and trajectory

Manual `/compact` executes through the command registry in the selected preset's
realm. Calling a deployment-level compaction service would bypass its isolated
engine. Normalized command errors are rethrown; a preset without an engine
returns an explicit unsupported error. Automatic compaction stays owned by the
preset's policies.

The event mapper consumes the compaction start/summary/end bracket and emits a
boundary/status result. The replacement history message is not displayed as a
new user message. The backend also settles manual failures that produce no log
bracket.

Trajectory is a host-side projection of the durable log into shared
`trajectory-types.ts`, rendered by desktop's `components/trajectory/`. It joins
records by IDs and brackets, not timestamps. Request headers arrive after step
start and must be adopted then. Turns/steps are 1-based. The response keeps the
last 2000 records with a dropped count and caps each inspector payload at
512,000 characters. A provider session not created yet is `absent`, not failure.

## 15. Runtime plugin installation

`packages/deepseek/src/plugin-host/` separates installation, registry and Loader
mounting. The npm-style root contains packages; `registry.json` holds rows
`{ id, name, config, disabled, version }`. Writes use locks and atomic replacement.
Install, enable, reconfigure, disable and uninstall reconcile through
`DeepseekPlugins.sync()`; one bad plugin is reported without sinking the tree.

The resolver registers a realpath-normalized plugin root before its first
import and redirects only `@deepseek-ai/*` imports from registered roots to the
host copies. This avoids a second Cordis Context and preserves service identity.
Imports outside those roots keep normal resolution.

Install checks compatible peers before mutation. Directory, tarball and npm
registry sources are supported; tarballs stage in a temporary directory first.
Registry installation fetches one package, not a dependency tree. Missing
non-dsh dependencies are reported as `unmetDependencies`. Prerelease peer ranges
use semver rules; `workspace:^` is unchecked for local development, not silently
reported compatible.

`InstallOptions.trust: 'granted'` is required because plugins execute with full
host Node privileges. The settings UI owns that explicit trust action; mini-app
sandbox expectations do not apply. See [contracts](contracts.md) for module and
Loader pitfalls and [backlog](backlog.md) for remaining verification.
