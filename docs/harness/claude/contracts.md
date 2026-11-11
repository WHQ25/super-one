# Claude Agent SDK behavioral contracts

Upstream behavior SuperOne depends on that `sdk.d.ts` does not state, or states
differently from what the runtime does. "Observed" names the version and method;
re-check an entry when an upgrade touches its area.

## Spawn and environment

### `Options.env` replaces the environment

- **Behavior:** When `env` is set, the child gets exactly that object;
  `process.env` is not merged in. Omitting `env` inherits `process.env`.
  (0.2.111–0.2.112 briefly merged; 0.2.113 reverted.)
- **Observed:** 0.2.113–0.2.118, `sdk.mjs` source.
- **Depends on it:** `apps/desktop/src/main/session/backends/claude-backend.ts`
  (`buildSafeEnv(custom)` lays custom provider env over the full process env, so
  the Bash tool keeps `PATH`).
- **Guard:** `apps/desktop/src/main/session/backends/claude-backend.test.ts`
  (third-party provider env keeps `PATH`).

### Settings-file `env` beats the spawn environment

- **Behavior:** Claude Code writes the `env` blocks of user/project/local
  settings into its own `process.env` at start, overriding what the parent
  passed. The flag-settings layer (`Options.settings`) sits above those files.
- **Observed:** Claude Code 2.1.272, loopback probe of request headers.
- **Depends on it:** `packages/claude/src/provider-settings-env.ts#providerSettingsEnv`,
  mirrored into `settings.env` by desktop `claude-query.ts#buildClaudeOptions`
  (`settingsEnv`) and by `packages/claude` run/live sessions.
- **Guard:** `packages/claude/src/provider-settings-env.test.ts`.

### Third-party endpoints count as first party

- **Behavior:** A custom `ANTHROPIC_BASE_URL` is still `firstParty`; unknown model
  ids get every capability, so mid-conversation tool changes send blocks that
  Anthropic-compatible third parties reject. `CLAUDE_CODE_MODEL_CAPABILITIES`
  negates one capability without dropping 1M context or thinking.
- **Observed:** Claude Code 2.1.269, binary strings.
- **Depends on it:** `packages/shared/src/platform-registry/claude-env.ts#claudeThirdPartyEnv`
  (`-mid_conv_tool_change`).
- **Guard:** unguarded against upstream change; a new rejected capability shows
  up as a 400 on third-party providers.

### Native binary path inside `app.asar`

- **Behavior:** The SDK resolves the platform binary through `require.resolve`,
  which returns an `app.asar/...` path in packaged Electron; spawning it fails with
  `ENOTDIR`. Electron's asar rewrite does not apply.
- **Observed:** 0.2.114+ (native binary packages), packaged 0.21.5-alpha.
- **Depends on it:** `apps/desktop/src/main/agent/claude-binary.ts`,
  `packages/claude/src/resolve-sdk-binary.ts` (rewrite to `app.asar.unpacked`,
  both separators).
- **Guard:** `apps/desktop/src/main/agent/claude-binary.test.ts`.

### Bundled Linux binary must match the host libc

- **Behavior:** Optional glibc and musl SDK binary packages can coexist, so an
  existing executable path does not prove that its dynamic loader is available.
  The bundled lookup selects one variant by the running process's diagnostic
  report (`header.glibcVersionRuntime` means glibc; a header without it means
  musl). If reports are unavailable or throw, Alpine/`/lib/ld-musl-*` markers
  provide the fallback; otherwise the lookup defaults to glibc. A reported glibc
  takes precedence over an additional musl loader. A missing matching package
  is a missing runtime, not a reason to choose the other libc variant.
- **Observed:** SDK/native 0.3.318 on glibc Linux with both packages installed;
  the previous shared and desktop lookups selected musl and the native process
  failed to launch. The corrected shared lookup starts `2.1.318 (Claude Code)`.
- **Depends on it:** `packages/claude/src/resolve-sdk-binary.ts` owns the shared
  lookup and asar rewrites. Desktop calls its uncached `findBundledClaudeBinary`
  only after explicit/managed paths and only when developer fallback is enabled.
  The shared node wrapper retains its cache; desktop misses stay uncached so a
  later package or managed install is discoverable. No SDK is loaded by this
  helper, and libc detection starts no subprocess.
- **Guard:** `packages/claude/src/resolve-sdk-binary.test.ts` (glibc/musl,
  mismatched/missing packages, report fallbacks, architectures and macOS/Windows
  asar paths), `apps/desktop/src/main/agent/claude-binary.test.ts` (both variants,
  precedence, packaged gating and installation races). The opt-in native hook
  test uses the resolved binary explicitly and passes on real glibc Linux;
  musl/macOS/Windows behavior has fixture coverage, not native acceptance here.

## Sessions, resume and fork

### Native identity must survive an interrupted first turn

- **Behavior:** SDK messages carry `session_id` before `result`; `system/init`
  may arrive before a user turn is active. Keeping this identity only in the live
  query loses the association on a host restart, even when chat events survive.
- **Observed:** SDK 0.3.310 message shapes and SDK-shaped live stream fixtures.
- **Depends on it:** `ClaudeLiveSession` reports a newly learned identity before
  mapping output, including idle init and cancelled-turn drain. The node runner
  binds the latest persistence sink and immediately forwards an already-known
  identity, so reopening a live process never depends on a turn result. A cold
  send with prior history but no valid identity fails instead of starting blank.
- **Guard:** `claude-live-session.test.ts` covers idle init, output ordering and
  queued turns; node `claude-turn-runner.test.ts` checkpoints SQLite before the
  first result and verifies `Options.resume` after interruption or restart.

### Resume reports cumulative usage

- **Behavior:** Since 0.3.277 the first `result` after resume or fork carries the
  transcript's cumulative `total_cost_usd` and `modelUsage`, not a delta from zero.
- **Observed:** 0.3.277, changelog and usage-stats audit.
- **Depends on it:** `apps/desktop/src/main/agent/claude-query.ts`
  (`modelUsageBaseline` treats the first result as a baseline), fed from both
  `Session` start options and `ClaudeBackend` idle/interrupt revive.
- **Guard:** `apps/desktop/src/main/agent/claude-query-usage-baseline.test.ts`.

### Resume and fork are scoped to the cwd

- **Behavior:** Transcripts live in `~/.claude/projects/<slug>/<id>.jsonl`, slug =
  `realpath(cwd)` with non-alphanumerics replaced by `-`. `resume` only searches
  the current cwd's folder, so `forkSession: true` with a different cwd fails.
  The standalone `forkSession()` writes into the source session's folder; moving
  the file lets a plain `resume` in the target cwd find it. Forks do not carry
  file-history checkpoints.
- **Observed:** 0.3.143, end-to-end fork to a worktree.
- **Depends on it:** `packages/claude/src/fork-session.ts`,
  `packages/claude/src/transcript-store.ts#claudeProjectSlug`.
- **Guard:** `packages/claude/src/fork-session.test.ts`.

### Worktree tools report the directory the CLI moved to

- **Behavior:** `EnterWorktree` returns `worktreePath` and `worktreeBranch` in
  the structured `tool_use_result`; `ExitWorktree` returns `restoredCwd`, with
  `originalCwd` as a fallback. The host follows these results without restarting
  the CLI. Subagent worktrees and replayed or failed results do not move the
  main session. The host also reconciles `session_init.session.cwd` so a
  restored directory does not depend on replaying an earlier tool result. That
  cwd also follows a plain Bash `cd`, so the host resolves it to the checkout it
  lies in (the project, or a linked worktree root with a `.git` file) and a
  subdirectory leaves the session where it is.
- **Observed:** 0.3.296, captured tool-result shapes in
  `packages/claude/src/worktree-cwd.test.ts`.
- **Depends on it:** `packages/claude/src/worktree-cwd.ts`, desktop
  `claude-query.ts#iterateMessages`, and `session.ts#adoptAgentCwd`.
- **Guard:** `packages/claude/src/worktree-cwd.test.ts`;
  `apps/desktop/src/main/session/session-agent-cwd.test.ts`;
  `apps/desktop/src/renderer/src/stores/chat-store/slices/event-slice.test.ts`.

### Truncating resume is refused, not retried

- **Behavior:** `resumeSessionAt` with `resumeDropsTurn` fails with a
  `Resume rejected by --resume-drops-turn:` result when the turn no longer
  matches. Retrying the same arguments fails again.
- **Observed:** 0.3.226+ (`resumeDropsTurn`).
- **Depends on it:** `RESUME_DROPS_TURN_REFUSAL_PREFIX` in
  `packages/claude/src/agent-event-mapper.ts` and desktop `claude-query.ts`; the
  caller clears the fork target and does a full resume. Both options are plumbed
  through desktop `buildClaudeOptions` and `packages/claude`, but no production
  path sets them today.
- **Guard:** `apps/desktop/src/main/agent/claude-query.test.ts`.

### System prompt snapshots are disabled

- **Behavior:** Since 0.3.267 the rendered system prompt is recorded on the first
  request and replayed verbatim on later launches until compaction, unless
  `systemPrompt.snapshot` is `false`.
- **Observed:** 0.3.267, changelog.
- **Depends on it:** every `systemPrompt` SuperOne builds sets `snapshot: false`
  so resumed sessions see the current SuperOne append.
- **Guard:** unguarded.

## Turn lifecycle

### Background work outlives `result`

- **Behavior:** `result` ends the model turn, but background tasks keep running.
  `task_started` / `task_updated` (`patch.status`) / `task_notification` track
  them; the session is idle only when `result` has arrived and no task is active.
  Since 0.3.274 queued background completions are merged into one model call but
  each still emits a `result`; the non-final ones are empty with `num_turns: 0`.
- **Observed:** 0.2.114 (task messages), 0.3.274 (merged completions).
- **Depends on it:** `activeBackgroundTasks` in desktop `claude-query.ts` and
  `packages/claude/src/agent-event-mapper.ts`.
- **Guard:** `apps/desktop/src/main/agent/claude-query.test.ts` (background task
  cases); the empty-`result` case is unguarded.

### Session crons live in the CLI process and are reported only to Stop

- **Behavior:** CronCreate, ScheduleWakeup and `/loop` timers are in-process;
  closing the query drops them without any message. The current set is reported
  only as `session_crons` on the Stop (and SubagentStop) hook input, which runs
  before the turn's `result`: a CronCreate turn reports the job, a CronDelete
  turn reports `[]`. A fired cron starts a turn with no host input (see
  [A mod can start a turn](#a-mod-can-start-a-turn)).
- **Observed:** 0.3.300 live probe (Stop reported the job after CronCreate and
  `[]` after CronDelete).
- **Depends on it:** `SessionScheduleTracker` (`packages/claude/src/session-crons.ts`),
  which holds idle runtime release (`hasScheduledWakeups` in desktop
  `claude-backend.ts` and `claude-live-session.ts`) and emits the
  `session_schedules` event behind the status bar's Scheduled Wakeups chip. A
  turn that ends without a Stop hook (interrupt) leaves the last report
  standing, which only delays a release. ScheduleWakeup is stored as a one-shot
  cron, so it appears in the same report. A fired timer's turn arrives as
  `command_lifecycle` then assistant frames, with no user message (0.3.300 probe).
- **Guard:** `apps/desktop/src/main/session/backends/claude-backend.test.ts`,
  `packages/claude/src/claude-live-session.test.ts`.

### `priority: 'now'` ends the turn as `aborted_tools`

- **Behavior:** A user message sent with `priority: 'now'` ends the running turn
  as `subtype: 'success'` with `terminal_reason: 'aborted_tools'`, and the
  steer's answer follows as its own turn. Since 0.3.286 a running shell command,
  agent or MCP call is no longer stopped: a foreground Bash call keeps running
  (reported as a `task_started` / `task_notification` pair), its `tool_result`
  arrives normally, and `permission_denials` stays empty. Before 0.3.286 the
  tools in flight were aborted and listed in `permission_denials`. A
  WebFetch/WebSearch that steps aside reports `tool_use_result:
  { detachedToolCall: true }` (0.3.287). A steer that lands while the reply is
  streaming ends that turn with `terminal_reason: 'aborted_streaming'`. A user
  Stop instead ends with `error_during_execution`.
- **Observed:** 0.3.x, trace; 0.3.287 live probe.
- **Depends on it:** `apps/desktop/src/main/session/backends/claude-backend.ts`
  (`steeredTurnMessageId` strips the terminal reason from a steered turn);
  desktop `claude-query.ts` backfills a denied result for calls still listed in
  `permission_denials`, a no-op since 0.3.286.
- **Guard:** `apps/desktop/src/main/session/backends/claude-backend.test.ts`.

### Interrupt leaves queued messages; cancelling them is untyped

- **Behavior:** `interrupt()` resolves with a receipt whose `still_queued` lists
  user messages the CLI still holds. The runtime `Query` has
  `cancelAsyncMessage(uuid)` (control request `cancel_async_message`), but
  `sdk.d.ts` does not declare it.
- **Observed:** 0.3.284, `sdk.mjs` and `sdk.d.ts`.
- **Depends on it:** `ClaudeBackend.interrupt` in
  `apps/desktop/src/main/session/backends/claude-backend.ts` reaches it through a
  cast and rebuilds the runtime when it is missing or fails.
- **Guard:** `apps/desktop/src/main/session/backends/claude-backend.test.ts`;
  re-check the method exists on every upgrade, since no type error will flag it.

### `/goal` state arrives late and only from the Stop hook

- **Behavior:** `/goal <condition>` first runs the condition as a normal turn;
  the CLI then replies `Goal set: …` as local command output. The active-goal
  message is only sent by the Stop hook evaluation; clear, met and impossible all
  arrive as `null`.
- **Observed:** Claude Code 2.1.272, trace and binary strings.
- **Depends on it:** `apps/desktop/src/main/session/backends/claude-goal-tracker.ts`.
- **Guard:** `apps/desktop/src/main/session/backends/claude-goal-tracker.test.ts`.

## Permissions and subagents

### In-place permission and directory changes

- **Behavior:** `allowDangerouslySkipPermissions: true` alone skips nothing; it
  only allows `bypassPermissions`. `setPermissionMode` applies both ways without a
  restart. `applyFlagSettings({ permissions: { additionalDirectories } })` adds
  directories mid-session, but directories given at spawn become `--add-dir`
  arguments that flag settings cannot remove. Each top-level key passed to
  `applyFlagSettings` replaces the previous value of that key.
- **Observed:** 0.3.x, controlled experiments (2026-06-12).
- **Depends on it:** `claude-backend.ts` (`_spawnedAdditionalDirs` forces a
  rebuild when a spawn-time directory is removed).
- **Guard:** unguarded at the backend; `apps/desktop/src/main/session/session.test.ts`
  only covers the session calling `setAdditionalDirectories`.

### `canUseTool` does not run in auto or bypass mode

- **Behavior:** `canUseTool` fires only when a permission prompt is needed.
  PreToolUse hook callbacks fire in every mode, and `agent_id` on the hook input is
  set only inside a subagent.
- **Observed:** 0.3.x, a subagent renamed the session under bypass.
- **Depends on it:** `denySubagentSessionRename` in desktop `claude-query.ts`
  (main-thread-only SuperOne tools).
- **Guard:** `apps/desktop/src/main/agent/claude-query.test.ts`.

### MCP tool permission rule names

- **Behavior:** A tool's rule name is `mcp__{server}__{tool}`, each segment with
  characters outside `[a-zA-Z0-9_-]` replaced by `_`. For a `claude.ai ` server,
  runs of `_` also collapse and are trimmed at the ends. Rules from user,
  project and local settings merge; deny is checked before ask, and ask before
  allow. An SDK `tools[].permission_policy` turns into the same rules.
- **Observed:** 0.3.302, native binary (`Cn`, `qs`, `UQe`).
- **Depends on it:** `claudeMcpToolRuleName` in `packages/shared/src/tool-ui.ts`
  and `packages/runtime/src/fs/mcp-tool-permissions-claude.ts`, which back the
  MCP settings page's per-tool permission control.
- **Guard:** `packages/runtime/src/fs/mcp-tool-permissions-claude.test.ts` (name
  shapes only; the binary's rule is unguarded).

### Subagents do not see the main system prompt append

- **Behavior:** `systemPrompt.append` reaches the main agent only; there is no
  public option for built-in subagents' prompts. Tool descriptions of always-loaded
  MCP tools are the only text every subagent sees.
- **Observed:** 0.3.181, source and runtime markers.
- **Depends on it:** placement of guidance in
  `apps/desktop/src/main/agent/superone-system-prompt.ts` versus SuperOne MCP tool
  descriptions.
- **Guard:** unguarded.

### A resumed subagent run is named by the SendMessage call

- **Behavior:** SendMessage to a finished subagent starts a new run of the same
  task: `task_started` (`is_backgrounded: true`) keeps the `task_id` and gets a new
  `run_id`, and the run's `task_*` events carry the SendMessage call's
  `tool_use_id`. The resumed output keeps the original Agent id as
  `parent_tool_use_id` and carries `agent_id` = `task_id`. An earlier trace
  (CLI version unrecorded) showed no `task_started` for the run at all.
- **Observed:** Claude Code 2.1.292, live probe.
- **Depends on it:** `withSubagentResumeSignal` in
  `apps/desktop/src/main/agent/subagent-resume-signal.ts` re-keys those events to
  the Agent block and, for a CLI that does not register the run, announces it
  itself. The renderer's `resolveTaskProgressWrite` also resolves by `task_id`.
- **Guard:** `apps/desktop/src/main/agent/subagent-resume-signal.test.ts`.

### SessionStart hook callbacks never run

- **Behavior:** An in-process `SessionStart` callback in `Options.hooks` is
  announced to the binary and `hook_started` / `hook_response` are emitted, but the
  `hook_callback` request never arrives; the callback body does not execute.
- **Observed:** 0.3.154.
- **Depends on it:** session naming goes through the SuperOne `session_rename`
  tool instead of a hook.
- **Guard:** unguarded; re-test before relying on in-process SessionStart hooks.

## Messages

### Typed messages may not be emitted, untyped ones may be

- **Behavior:** A message type in `sdk.d.ts` is not proof the runtime sends it
  (`session_state_changed` was typed long before it was sent), and the runtime
  sends messages and fields that are not declared: `system/model_fallback`,
  `active_goal`, `command_lifecycle`, `tool_use_id` on `system/task_updated`,
  and the mods messages `system/ui_log {plugin, text}`,
  `system/ui_toast {plugin, text, timeout_ms}` and
  `system/ui_status {plugin, text | null}`.
- **Observed:** 0.2.114 (`session_state_changed`), 0.3.232–0.3.284
  (`model_fallback`), 0.3.284 (the others), 0.3.287 (`ui_*`).
- **Depends on it:** `packages/shared/src/model-fallback-wire.ts` reads fallback
  fields defensively; both mappers handle `active_goal` (→ `session_goal`);
  desktop `claude-query.ts` handles `command_lifecycle` and reads `tool_use_id`
  on `task_updated`; `packages/claude/src/plugin-notice-wire.ts` maps `ui_*`
  (→ `plugin_notice`).
- **Guard:** verify new subscriptions with a trace before relying on them.

### Task tools carry the real id only in the result

- **Behavior:** `TaskCreate` input has no id; the SDK-assigned id is only in the
  tool result's `tool_use_result.task.id`, and `TaskUpdate.taskId` refers to it.
- **Observed:** 0.3.142.
- **Depends on it:** `extractTaskCreateTodo` in desktop `claude-query.ts`.
- **Guard:** unguarded at extraction; `apps/desktop/src/main/remote-control-service.test.ts`
  covers the consumer side.

## Mods

Claude Code mods (2.1.287+) are plugins whose `hooks/hooks.json` names a hooks
module that runs inside the CLI process. Upstream docs:
<https://code.claude.com/docs/en/plugins/mods/overview>.

### Installed mods run in SDK sessions

- **Behavior:** Mods are on by default and load with the user's plugins, so
  `settingSources` with `user` runs them in every SuperOne session. Their hooks
  run; what they draw (panes, the band above the prompt, replaced rows)
  reaches an SDK host only if it attaches as a surface (see "Mod UI rides a
  private control protocol"). What reaches every host: `ui_log` / `ui_toast` / `ui_status`
  (raised in `session.start` they arrive before `system/init`), and the effects
  of their hooks. The CLI writes `.claude-plugin/types/` into the plugin
  directory when it loads one.
- **Observed:** 0.3.287 live probe.
- **Depends on it:** `plugin_notice` mapping in both mappers.
- **Guard:** `apps/desktop/src/main/agent/claude-query.test.ts`,
  `packages/claude/src/plugin-notice-wire.test.ts`.

### A mod can approve a tool call without `canUseTool`

- **Behavior:** A `tool.check` hook answering `{ decision: 'allow' }` runs the
  call with no `can_use_tool` request, under `permissionMode: 'default'`.
  SuperOne's approval prompt never appears for it.
- **Observed:** 0.3.287 live probe (`touch` ran; `canUseTool` was not called).
- **Depends on it:** nothing; the user installed the mod. Upstream documents it.
- **Guard:** unguarded.

### A mod can start a turn

- **Behavior:** `$.prompt.submit` after a `result` starts a turn with no host
  input: `command_lifecycle`, a second `system/init`, assistant frames, then its
  own `result`.
- **Observed:** 0.3.287 live probe.
- **Depends on it:** the self-started turn path in desktop `claude-query.ts`
  (`resultSeen || !turnMessageId` mints a message) and the ambient turn in
  `packages/claude/src/claude-live-session.ts`, the same paths a background
  task's wake takes.
- **Guard:** `apps/desktop/src/main/agent/claude-query.test.ts` (a turn a mod
  submits after the result).

### A hooks module that fails to load is not in `plugin_errors`

- **Behavior:** A hooks module the CLI refuses at load (for example a
  `turn.step` hook that is not an async generator) leaves the plugin in
  `plugins[]` with no `plugin_errors` entry. The reason is only in the debug log.
- **Observed:** 0.3.287 live probe.
- **Depends on it:** nothing; SuperOne can only show what `plugin_errors` reports.
- **Guard:** unguarded.

### Mod UI rides a private control protocol

- **Behavior:** What mods draw reaches an SDK host only through control
  requests `sdk.d.ts` does not declare (`ui_attach`, `ui_render`, `ui_press`,
  `ui_input`, `ui_select`, `ui_panes`, `ui_pane_show`, `ui_pane_focus`,
  `ui_close`, `ui_scroll`, `ui_focus`, `ui_client_module`, `ui_client_press`,
  `ui_message`, `ui_prompt_edit`, `ui_detach`), sent with the runtime's
  `Query.request()`, and CLI→host requests (`promptRead` / `promptFill` /
  `promptSuggest` / `copy`) answered through `Query.setUiHost()`. Pushes are
  `system/ui_invalidate`, `ui_panes`, `ui_scroll`, `ui_focus`. The CLI lists
  `ui_surface_v1` in `initializationResult().capabilities` before any turn,
  and `ui_render` answers in 0–9 ms. Surfaces are a closed set (`desktop`,
  `mobile`, `vscode`); SuperOne attaches as `desktop` and each phone as
  `mobile`. `ui_attach` refuses a `client_id` that is not 1-64 of letters,
  digits, `.`, `_` or `-` (`:` is reserved by the CLI). An error reply to a
  CLI→host request costs the CLI a 5 s wait.
- **Observed:** 0.3.287 live probe and recordings; the `client_id` rule from a
  phone attach refused in 0.3.287.
- **Depends on it:** `packages/claude/src/mod-surface/` (the only place that
  touches `request` / `setUiHost`; it is unavailable when either is missing),
  and every surface in [features/claude-mods.md](../../features/claude-mods.md).
- **Guard:** `packages/claude/src/mod-surface/mod-surface.test.ts` (capability
  gate, missing private API, recorded ops, pushes and host requests);
  `packages/shared/src/mod-ui.test.ts` (derived client ids).

### Only the first engine ref carries rewritten props

- **Behavior:** A tree that holds several `engine` nodes (a hook that calls
  `next` twice) answers refs 1, 2, …; only the first non-zero ref's rewritten
  props cross in the response. `rewritten: true` is set even when a hook passed
  the props through unchanged.
- **Observed:** 0.3.287 live probe.
- **Depends on it:** `packages/chat-view/src/mod-ui/ModTree.tsx` (the first ref
  draws with the response props, later refs with the request props; nothing
  reads `rewritten`); `engineOnce` sites (AskUserQuestion) draw SuperOne's own
  unless exactly one ref is present.
- **Guard:** `packages/chat-view/src/mod-ui/engine-refs.test.ts`.

### Host props are not validated

- **Behavior:** The CLI passes the props a host sends for a site to its hooks
  unchecked; a missing field reaches the hook as `undefined`. `tool_use_id` is
  filled from `instance_id`.
- **Observed:** 0.3.287 live probe.
- **Depends on it:** the site prop builders in
  `packages/chat-view/src/mod-ui/site-props.ts`, which are the contract.
- **Guard:** `packages/chat-view/src/mod-ui/site-props.test.ts`.

### A mobile ask is filtered by the CLI

- **Behavior:** A `mobile` render strips `Input`, `Select` and `Client` from the
  tree; hooks on sites the phone never draws still run if asked.
- **Observed:** 0.3.287 live probe.
- **Depends on it:** the phone draws the CLI's tree with no host-side filter
  and asks only the sites it shows (no `AbovePrompt`).
- **Guard:** unguarded.

### `$.ui.ask` and hot-reload consent arrive as AskUserQuestion

- **Behavior:** `$.ui.ask` arrives as `canUseTool('AskUserQuestion')` with
  `toolUseID` `toolu_plugin_<hex>` and no transcript row; the dev-folder consent
  arrives the same way with `confirm_<uuid>` and `metadata.source:
  'mod_hot_reload'`. An `updatedInput.answers` reply reaches the mod as the
  chosen label.
- **Observed:** 0.3.287 live probe; SuperOne's existing question prompt
  answered both on 2026-10-04.
- **Depends on it:** the AskUserQuestion path in `claude-permissions.ts` and
  `SessionDecisionPrompts.tsx`, which must not assume a tool row.
- **Guard:** unguarded.

### Mod development folders hot-reload from the spawn environment

- **Behavior:** `CLAUDE_CODE_PLUGIN_DIRS` loads plugin folders from disk and
  `CLAUDE_CODE_PLUGIN_DIR_WATCH=1` reloads them on save: an un-narrowed
  `ui_invalidate`, `session.start` again, and a `ui_log` "reloaded" line.
- **Observed:** 0.3.287 live probe; SuperOne preference live on 2026-10-04.
- **Depends on it:** `packages/claude/src/mod-surface/dev-folders.ts`, applied by
  desktop `claude-query.ts`. Spawn-time only: a change rebuilds the session.
- **Guard:** `packages/claude/src/mod-surface/dev-folders.test.ts`.

### A mod command's reply is a synthetic assistant message

- **Behavior:** A command a mod registered replies with an `assistant` message
  of `model: "<synthetic>"` carrying `local_command_run: { command, args }`,
  then a `result` with `num_turns: 0`. Commands are listed in
  `initializationResult().commands`, without any `immediate` flag.
- **Observed:** 0.3.287 live probe.
- **Depends on it:** slash output in desktop `claude-query.ts`, wrapped as the
  `CommandOutput` site. Commands a mod registers `immediate` still queue behind
  a running turn in SuperOne.
- **Guard:** `apps/desktop/src/main/agent/claude-query.test.ts` (slash output).

### `Client` modules run on the host

- **Behavior:** `ui_client_module` returns the plugin's surface modules plus
  `claude:surface-runtime` and bounds (nodes 20000, depth 32, chars 100000).
  The runtime's `install(host, limits)` takes `schedule`, `startTimer`,
  `stopTimer` and `post`; the host drives it with `stage(id, kind, payload)`
  (`render`, `pointer`, `key`, `tick`, `held`) then
  `globalThis.__surface__.run()`, which returns the tree's JSON for `render`.
  Pressables carry `held` handles: `ui_client_press` answers `reached`, then the
  host stages `held`. `ui_message` answers the hooks module's new `props`.
  Pointer events are `{ type, x, y, button?, shift?, alt?, ctrl? }` in the
  Client's cells; keys use `onKey`'s names (`up`, `return`, `space`, …).
- **Observed:** 0.3.287 recordings and binary strings.
- **Depends on it:** `packages/chat-view/src/mod-ui/client-frame.ts` and
  `ClientFrame.tsx` (an opaque sandboxed frame, nonce-only CSP).
- **Guard:** `packages/chat-view/src/mod-ui/client-frame.test.ts` for SuperOne's
  side; the runtime itself is unguarded against upstream change.

### `ui_prompt_edit` answers whether or not a mod hooks it

- **Behavior:** Every edit sent is answered: unhooked, the box comes back with
  no runs; a newer edit from the same client answers the older one
  `superseded`. A remote client gets no signal that `prompt.edit` is hooked. A
  local round trip measured about 0.2 ms.
- **Observed:** 0.3.287 live probe, 2026-10-04.
- **Depends on it:** `packages/chat-view/src/mod-ui/prompt-edit.ts`, used by the
  desktop composer for local sessions only.
- **Guard:** `packages/chat-view/src/mod-ui/prompt-edit.test.ts` for the relay;
  upstream behavior unguarded.

## MCP Apps

### The host flag works only in the spawn environment

- **Behavior:** The CLI advertises the MCP Apps extension to servers, returns
  tool `_meta.ui` from `mcpServerStatus` and hides app-only tools from the
  model only when `CLAUDE_CODE_MCP_APPS_HOST=true` is in the spawn env. The
  same key in `settings.env` has no effect. Tool annotations arrive as
  `readOnly` / `destructive` / `openWorld`, not the MCP `*Hint` names.
  Runtime `serverInfo` also preserves `title` and `icons` (Bits & Bolts,
  2026-10-01), although the SDK type declares only name/version.
- **Observed:** 0.3.285, live fixture server (`server/discover` precedes
  `initialize`).
- **Depends on it:** `packages/claude/src/mcp-apps.ts#withMcpAppsHostEnv`, used
  by desktop `claude-query.ts#buildClaudeOptions`, `run-sdk-turn.ts` and
  `claude-live-session.ts`; `toMcpToolDescriptor` maps the annotations.
- **Guard:** `packages/claude/src/mcp-apps.test.ts`;
  `apps/desktop/scripts/check-claude-mcp-apps.ts` (live).

### MCP results are post-processed, and subagents keep only `_meta`

- **Behavior:** A model-turn MCP result reaches the host as top-level
  `tool_use_result = { content, structuredContent, _meta }`, where `content` is
  a string (the JSON of `structuredContent` when present), so the server's
  text blocks are lost. Inside a subagent `tool_use_result` is only a
  size-capped `{ _meta }`; the `tool_result` block text is the only content.
- **Observed:** 0.3.285, recorded turn with a direct and an async subagent call.
- **Depends on it:** `claudeMcpToolResult` in `packages/claude/src/mcp-apps.ts`
  (falls back to the block content; no `structuredContent` for subagent rows).
- **Guard:** `apps/desktop/src/test/integration/claude-mcp-apps-backend.test.ts`
  (recording `claude-mcp-apps.sdk.json`).

### `mcp_call` has no visibility check and reports `isError` as a failure

- **Behavior:** The internal `mcp_call` control request runs any tool,
  including model-only ones, without `canUseTool`, unless `check_permissions`
  is set. SuperOne leaves it unset. A result with `isError`
  rejects the request with `control_request_failed`, indistinguishable from
  "could not run". An `AbortSignal` sends `control_cancel_request`, and the
  server gets `notifications/cancelled`.
- **Observed:** 0.3.287 and 0.3.289, live fixture server.
- **Depends on it:** the dispatch gate in
  `packages/runtime/src/mcp-apps/provider-rpc.ts` enforces app visibility
  before the provider; `createClaudeMcpAppsProvider` reports a rejected call
  and an abort after dispatch as `unknown_outcome`.
- **Guard:** `CLAUDE_MCP_CALL_VERIFIED_SDK` is pinned to the SDK dependency by
  `apps/desktop/src/main/mcp-apps/claude-provider.test.ts`; on a bump, rerun
  `bun apps/desktop/scripts/check-claude-mcp-apps.ts`.

### MCP elicitation: URL consent and withdrawal

- **Behavior:** The CLI advertises URL-mode elicitation by default, so servers send
  `mode: 'url'` requests; without a host answer they are declined and the model is
  told to open the URL itself. In URL mode `accept` means the user agreed to open
  the link, not that the flow finished: a 2025-11-25 server may later send
  `elicitation_complete`, a 2026-07-28 server has no completion signal at all. The
  CLI aborts `onElicitation`'s `signal` when it gives up on a request (server
  timeout, the asking call stopped). An MCP call running past 2 minutes moves to
  the background (`task_type: 'mcp_task'`) and may ask after the turn ended.
- **Observed:** SDK 0.3.302–0.3.310 `sdk.d.ts`; Claude Code 2.1.281 / 2.1.287
  changelog and 2.1.302 / 2.1.310 binary strings. Not run against a live server.
- **Depends on it:** `packages/claude/src/elicitation.ts#claudeElicitationRequest`
  (`elicitationAcceptOnOpen`), `apps/desktop/src/main/agent/claude-permissions.ts#createOnElicitation`
  (abort withdraws the card with `interaction_resolved`),
  `packages/claude/src/claude-live-session.ts` (node declines between turns).
- **Guard:** `apps/desktop/src/main/agent/elicitation.test.ts`,
  `packages/claude/src/elicitation.test.ts`, `packages/claude/src/claude-live-session.test.ts`.

### OAuth with a host redirect needs a reconnect

- **Behavior:** `mcpAuthenticate(server)` without a redirect URI runs the CLI's
  own localhost listener and reconnects after the callback. With a host
  redirect URI (`redirectScheme: 'custom'`), `mcpSubmitOAuthCallbackUrl` stores
  the token but the server stays `needs-auth` until `reconnectMcpServer`.
  Neither method is in the public `Query` type.
- **Observed:** 0.3.285, fixture OAuth server.
- **Depends on it:** `createClaudeMcpAppsProvider` `authenticate` /
  `submitAuthCallback`; desktop `apps/desktop/src/main/mcp-apps/auth.ts` relays
  the callback for remote nodes.
- **Guard:** `apps/desktop/src/main/mcp-apps/provider-auth.test.ts`;
  `apps/desktop/scripts/check-mcp-apps-oauth.ts` (live).

### App-provided tools and sessionless entrypoint discovery stay host-owned

- **Behavior:** The Claude Agent SDK still withholds sibling tool `_meta` keys
  (`openai/ui` entrypoints) from `mcpServerStatus()` and provides no dynamic
  per-View tool injection channel without restarting or mutating query tool
  lists. Project-scoped `.mcp.json` stdio trust lives in `~/.claude.json` under
  `projects[cwd].enabledMcpjsonServers` and `enableAllProjectMcpServers`.
- **Depends on it:** SuperOne exposes View-provided tools (`app.registerTool`
  and WebMCP) through fixed `mcp_app_tools_list` and `mcp_app_tools_call` tools
  on `superone-mcp-server` (and Host Action on desktop-controlled remote nodes)
  paired with `<superone-mcp-app-tools>` turn context. Thread entrypoints in
  Claude sessions read full `Tool._meta` through `HostClients`; sessionless
  global entrypoint discovery (`apps/desktop/src/main/mcp-apps/entrypoints-cache.ts`)
  connects lazily via `host-client` only after checking `~/.claude.json`
  project trust for project-scoped `stdio` servers.
- **Guard:** `apps/desktop/src/main/mcp/mcp-app-tools-mcp.test.ts`;
  `apps/desktop/src/main/mcp-apps/entrypoints-cache.test.ts`.

## Warm start

### Warmup reuse key

- **Behavior:** A pre-spawned process can take in-place changes (`setModel`,
  `setPermissionMode`, `applyFlagSettings`) but not spawn-time options (`cwd`,
  `env`, `toolConfig`, `resume`, `sessionId`, `forkSession`).
- **Observed:** 0.3.x; `toolConfig` drift hit on 2026-06-12.
- **Depends on it:** `apps/desktop/src/main/agent/warmup-manager.ts#keyOf`, a
  hand-kept list of spawn-time options. A new spawn-time option must be added.
- **Guard:** `apps/desktop/src/main/agent/warmup-manager.test.ts`.


## Subscription credential domains

- **Behavior:** `CLAUDE_SECURESTORAGE_CONFIG_DIR` redirects credentials but does
  not redirect `oauthAccount` or transcript configuration. CLI `auth status`
  uses the config profile's email/org and can say `loggedIn: true` even with a
  synthetic credential; it is not a credential identity check.
- **Observed:** Claude Code 2.1.289 native binary and an isolated temporary-home
  probe: two different synthetic tokens return the shared profile, adding
  `CLAUDE_CONFIG_DIR` changes the profile and `projectsDirectory`, and an empty
  config returns null email/org. Issue #71 reports the same failure on 2.1.291.
- **Depends on it:** Managed auth and model sessions isolate both directories.
  Their `projects` directory links to the ambient CLI transcript root, preserving
  history/fork/resume. User settings/resources and MCP definitions/project
  approvals are inherited; OAuth profile fields remain account-local. Existing
  `claude-account:<directory>` IDs remain valid; `claude-account:cli` explicitly
  selects the external CLI, while a fresh session pins the chosen default.
- **Identity:** The CLI's embedded `/api/oauth/profile` request uses a Bearer
  token and expects `account.uuid`, `account.email`, and `organization.uuid`.
  Identity/deduplication uses account UUID plus organization UUID. Profiles are
  cached against a credential fingerprint; unknown, signed-out and unavailable
  domains are retained. Only confirmed matching identities are merged. Last
  verified identity belongs only to its token, and a late response cannot label
  replacement credentials. A managed profile keeps its original owner across
  re-login attempts; an unverified replacement token cannot spend quota under
  the previous owner. The account registry stores metadata, never tokens.
- **Guard:** `claude-account-service.test.ts`, `claude-usage-service.test.ts`,
  session default/restore tests, account-card and sidebar tests, and
  `ClaudeAccountsPanel.stories.tsx` (default switch, narrow, dark, loading/error,
  browser login and signed-out states).
- **Verification boundary:** Profile/renewal HTTP and auth subprocesses have
  fixture integration coverage. This checkout had no available default OAuth
  credential for a live profile request; real two-account browser login and
  model inference still require live acceptance. No CLI version upgrade is part
  of this change.


## Fast Mode

- The SDK model catalog owns model support (`ModelInfo.supportsFastMode`), which controls the selector switch for both API and subscription logins. Do not infer availability from an API key or account type: subscription accounts with usage credits can use Fast Mode too. Explicit provider model mappings do not inherit the SDK catalog's capabilities for a different model.
- Desktop and node send the session choice as `settings.fastMode` at query creation and `Query.applyFlagSettings({fastMode})` for a live switch. The warmup key includes the flag. A host wake that omits the field preserves the existing choice.
- Account availability, organization policy and rate limits remain SDK-owned. Disabled reasons such as `extra_usage_disabled`, `not_first_party` or `model_not_allowed` describe current availability, not model capability. `preference`, `pending` and `sdk_opt_in_required` must not prevent a user from opting in. `fast_mode_state` and `fast_mode_disabled_reason` are retained in init/result metadata, so requesting Fast never fabricates an applied `on` state.
- Verification: selector, launch settings and node runner tests use recorded catalog shapes and a fake SDK. No billed live inference is required by these checks.

### Node host queue and explicit steering

- **Behavior:** Ordinary composer sends during a running Claude turn stay in the
  node's FIFO as editable/removable queue cards. `session.steer` promotes one
  card and hands it to the existing SDK input stream with priority `now` or
  `next`, preserving the running process and its settings. The node rechecks
  the control lease immediately before handoff. A pre-handoff refusal restores
  the queue card. Host notifications retain their separate admission path.
- **Observed:** SDK 0.3.310 declares that `user_message_uuids` includes sends folded
  into a prompt between tool rounds. An explicit `next` send may therefore
  share the active turn's result rather than receive a separate result. Resolve
  all acknowledged sends while storing the answer once. For explicit `now`,
  suppress the displaced turn's `aborted_tools` / `aborted_streaming` completion
  warning; user Stop errors remain unchanged.
- **Depends on it:** `packages/runtime/src/session/queued-controls.ts`,
  `packages/runtime/src/session/session-runtime.ts`,
  `packages/claude/src/claude-live-session.ts`, `apps/cli/src/session/claude-turn-runner.ts`.
- **Guard:** `packages/runtime/src/session/session-runtime.queue.test.ts`,
  `packages/claude/src/claude-live-session.test.ts`,
  `apps/cli/src/session/claude-turn-runner.test.ts`.


## Process-scoped system notices and hook failures

- **Behavior:** `system/informational` is plaintext with an info/notice/suggestion/
  warning level. `system/session_writes_lost` is sent at most once, and only when
  the CLI exits 0, after its final result if there was one. A run that exits 1
  gets the stderr line only. It reports native transcript/global-config loss, not
  failure of the completed model turn or proof that SuperOne's database lost data.
  A received result remains valid. Preserve unknown future storage codes/kinds.
- **Shutdown:** desktop and node stop accepting queued input, interrupt active
  work and cancel SDK-held queued messages, then end the input generator and
  drain only notices for up to three seconds before `Query.close()` and abort.
  Native persistence flushes can wait two seconds; the extra second allows the
  warning to be emitted. A busy, hung or slower-exiting process can exceed this
  deadline, so delivery during forced termination is best effort. The sink
  survives registry removal/session close until drain completes, and a new
  process for the same session waits for the old release. Notices persist
  without becoming a new assistant completion or changing session recency.
- **Observed:** 0.3.321 declarations (exit 0 only; 2.1.317 through some later
  builds also sent it on an error exit). Both mappers and node lifecycle tested with
  fixtures after result, while idle and during interruption. A real SDK reader
  received an EOF-only warning from a fixture process after a completed turn
  with bidirectional callbacks. Actual ENOSPC/EDQUOT was not induced on a live
  filesystem. Informational content, including `info`, remains visible in this
  transcript UI; `tool_use_id` is preserved in diagnostics, without speculative
  grouping or suppression.
- **Depends on it:** `packages/claude/src/system-notice.ts` appends complete
  `providerId: system` messages through `user_message_appended`, with replay-stable
  ids and `metadata.systemNotice`. The desktop handles them before its interrupt
  filter. A cancelled node turn routes them through the ambient sink; idle uses
  the existing system mapper. Node transient model input must not treat these
  assistant system rows as user prompts. Desktop/mobile share `SystemNoticeRow`.
- **Guard:** mapper/query/live-session tests; desktop Session persistence test;
  node SQLite read-model restart test; `query-shutdown` tests and opt-in
  `query-shutdown.native.test.ts` (`SUPERONE_TEST_CLAUDE_NATIVE=1`);
  `SystemNoticeRow.test.tsx` (literal text, translated storage warnings,
  expandable diagnostics and preserving the streaming assistant's identity).

### SDK hook failures can fail closed

- **Behavior:** SDK hook matcher `onFailure: block` blocks the guarded action
  when its callback throws or returns invalid output. The SDK refuses startup
  if the runtime cannot honor it or did not register those hooks; a host must
  not silently retry without it. Stop/SubagentStop/TaskCompleted/TeammateIdle
  ignore this option.
- **Observed:** SDK 0.3.321 forwards `onFailure` on the initialize matcher.
  The refusal sentence still starts with the same prefix and now continues
  "Update Claude Code if it is old, or remove onFailure: \"block\" from your hooks."
  A repeated initialize that did not register the hooks throws a different
  sentence and is not classified as `runtime_upgrade_required`.
- **Depends on it:** desktop `buildClaudeOptions` protects
  `denySubagentSessionRename` with `onFailure: block`. It does not replace the
  node executor's own authorization, or close pre-existing backlog G1.
  An older/custom runtime that cannot honor it receives an actionable update
  error. The fallback matches the SDK's internal error-message prefix; its
  version guard must be rechecked on every upgrade. Retiring desktop runtimes
  deny new tool permissions and decline elicitation rather than reopening cards.
- **Guard:** `packages/claude/src/sdk-hooks.native.test.ts`
  (`SUPERONE_TEST_CLAUDE_NATIVE=1`, no account or paid inference), and desktop
  Claude query option tests.

### Startup diagnostics survive terminal SDK exceptions

- **Behavior:** an error result may carry `startup_failure_reason` and recovery
  instructions before the SDK throws on process exit. Preserve that result's
  structured error rather than overwriting it with the later generic exception.
  Thrown initialization errors can also carry `startupFailureReason`. An exited
  query is retired, so repairing configuration and retrying starts a new one.
- **Guard:** `result-failure.test.ts`, desktop query terminal-exception tests and
  backend process-exit/retry regression.

### MCP OAuth hash normalizes absent headers

- **Behavior:** The native credential key is `<server>|<sha256-prefix>` over
  `JSON.stringify({type, url, headers: headers || {}})`, with 16 hex characters.
  Omitting headers from that object produces the wrong exact key; the previous
  URL/server fallback could conceal the mismatch. That fallback remains for
  older entries, with its ambiguity and URL checks unchanged.
- **Observed:** native 0.3.318 Linux file store, local OAuth fixture, both the
  CLI-owned callback and a relayed host callback. Both actual keys matched and
  tokens were readable; no user credentials were read or changed.
- **Depends on it:** `apps/desktop/src/main/mcp-apps/claude-mcp-token.ts`.
- **Guard:** `claude-mcp-token.test.ts`, and
  `bun apps/desktop/scripts/check-mcp-apps-oauth.ts --claude-only` on Linux.

### Additive Mod UI fields in 2.1.318

- **Behavior:** `ui_attach` adds optional `draws` for Backdrop and mobile
  Input/Select opt-ins. Omission on first attach advertises none; it retains
  existing opt-ins on repeated attach. `ui_prompt_paint` is a new opt-in host
  request. SuperOne advertises neither feature and keeps its previous behavior.
  Existing mapped request schema keys are otherwise unchanged from 2.1.310.
- **Observed:** both native binaries' schema text; existing recording replay;
  2.1.318 loaded Anthropic's token-weather, blast-radius and replay-theater
  through `withModDevFoldersEnv` in an isolated query. The adapter attached,
  rendered the token-weather tree with all three in `drawn_by`, read panes and
  detached. This was a protocol smoke, not a desktop/phone UI acceptance test.
- **Guard:** `packages/claude/src/mod-surface/mod-surface.test.ts`; new opt-ins
  remain backlog #30 until shared UI and host handlers exist.

### `ui_notify` in 2.1.321

- **Behavior:** Native 2.1.321 adds `system/ui_notify` and `system/ui_notify_cancel`
  beside `ui_log` / `ui_toast`. A notify carries plugin, source, title and plain
  text, plus an optional key, delay and fire time. Cancel withdraws one key for
  that source, or every notification from the plugin when the key is absent.
  `startup_ui_never_appeared` is a terminal-UI watchdog, not a host message.
  Every `ui_*` name SuperOne already sends is still in the binary. Unknown
  subtypes stay ignored.
- **Observed:** string compare of the darwin-arm64 binaries for 2.1.318 and
  2.1.321. Not exercised against a live mod.
- **Depends on it:** nothing yet. `mapPluginUiMessage` still accepts only
  `ui_log`, `ui_toast` and `ui_status`.
- **Guard:** existing plugin-notice tests. Adoption is backlog #34.
