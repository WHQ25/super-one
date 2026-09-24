# dsh `0.1.1-rc.2` → `0.1.7-rc.1` Upgrade

Status: **executed** on branch `feat/dsh-0.1.7` (worktree `dsh-017`). §5 records what was
verified and what is still open.
Last updated: 2026-09-24
Related: [`deepseek-harness-integration.md`](./deepseek-harness-integration.md) (§11 owns the
version strategy) · [`dsh-0.1.1-rc.2-upgrade.md`](./dsh-0.1.1-rc.2-upgrade.md) (the previous bump)

---

## 1. Scope

`next` is `0.1.7-rc.1` for every package; `latest` is still `0.1.0-rc.6` and must not be
installed from. Peers are now exact (`0.1.7-rc.1`, from upstream's `workspace:*`), so the whole
family moves together or not at all. The cordis family moved too: `cordis` 4.0.4, `group`
1.0.4, `include` 1.0.9, `loader` 1.0.5, `timer` 1.1.6, `schemastery` 3.18.4.

Package churn, as pinned in `packages/deepseek` and `apps/desktop`:

| Removed | Added |
|---|---|
| `dsh-agent-presets`, `dsh-code-runtime`, `dsh-tool-subagent-report`, `dsh-workflow-worker-thread` | `dsh-agent-preset`, `dsh-agent-preset-registry`, `dsh-ptc-runtime(-node)`, `dsh-workflow-ptc`, `dsh-workspace-changes`, `dsh-command-goal`, `dsh-tool-present`, `dsh-llm-retry`, `dsh-compaction-image-offload`, `dsh-mcp-resources`, `dsh-http-proxy`, `dsh-storage*`, `dsh-workspace`, `dsh-session-query`, `dsh-session-title`, `dsh-session-projection-cache`, `dsh-util-*`, … |

The log-upload packages (`dsh-session-log-*`) are deliberately **not** mounted.

## 2. Breaking changes and how they were absorbed

| Upstream change | SuperOne change |
|---|---|
| `dsh-session-projection` became a mandatory seam | Mounted right after `Timer` in `tree.ts`; without it every dependant waits forever |
| Presets are declaration rows (`dsh-agent-preset` + registry), `code` → `ptc` | Vendored the four upstream `*.patch.yml`; `presets.ts` applies them with `cordis-plugin-include`'s own `entryListSchema` / `applyEntryPatches`. One deviation left: the `tool-plugin-manager` row is dropped |
| Session format v0 → v4, handle-based persistence (`create` / `open` / `stat`), exclusive write lease through a native flock addon | `stored-session.ts` reads through handles; fork writes through `persistence.create` + `append`. v0 logs migrate on open (verified on 40 real sessions) |
| `assistant/chunk` removed; live text rides process-local `agent/assistant-stream` frames | Mapper consumes frames (`handleStreamFrame`), retracts attempts that do not commit |
| Tool results are `role: 'tool'` messages; system prompt logged as `system/message`; new `developer/message` | Mapper, trajectory fold, header diff and fixtures updated |
| cordis 4.0.3: `loader.create` / `await` no longer reject on plugin failure; `loader.remove` is sync | `entryFailure()` in `cordis-loader.ts` surfaces failures for the plugin host and MCP registrar |
| PTC runtime spawns a fresh Node with a scrubbed env | `ensurePtcNodeLauncher` writes a `ELECTRON_RUN_AS_NODE=1` launcher under `userData` (POSIX; Windows uses `node` on `PATH`) |
| `dsh-subprocess-local` spawns its runner as `[process.execPath, runner.js]` on Linux/Windows | Patched via `patchedDependencies` to set `ELECTRON_RUN_AS_NODE` (pre-existing bug; untested on Linux/Windows) |

## 3. Features adopted

- **Streaming tool input** (`supportsStreamingToolInput`) and **model retries** (`llm/retry` →
  `api_retry`); `compaction-image-offload` keeps image-heavy sessions going.
- **V4.1 Flash** (`deepseek-flash`, text + image, system prompt in history) in the catalog.
- **Questions and plan review.** `ask_user_question` and `exit_plan_mode` share the
  `user-questions/request` waterfall; `user-questions.ts` routes a `plan-review` intent to the
  plan card and everything else to the question prompt. `plan` mode also turns on dsh plan mode;
  an approved plan returns the session to `default`. Dismissal answers `ASK_CANCELLED`.
- **Queued input and steer.** Mid-turn messages wait in `QueuedUserMessageQueue`; steer hands
  one to `agent.steer()` (next step boundary, nothing cancelled — so no separate "steer soon").
- **MCP resources** from configured servers (`dsh-mcp-resources` on the host plane).
- **Shell file changes.** `dsh-workspace-changes` snapshots each turn; files no file tool showed
  render as Edit / Write / Delete rows through the same projection as Claude's `bashEditDiff`,
  emitted from `agent/turn-stopping` so they land before the turn completes.
- **Background work.** Upstream's continuable (background-by-default) delegation is enabled.
  Work is "background" when its launching call returned while it still runs: jobs and live
  children become `task_*` events; Stop on a row, session Stop, archive and dispose stop them.
- **Per-subagent model choice.** Settings → Harnesses → DeepSeek → Preferences; stored as
  `AppSettings.dshSubagentModelSelection`, pushed live through the loader (only its update path
  commits volatile config in place).

## 4. Not adopted

- **`rewindFiles`.** `dsh-workspace-changes` keeps its snapshots in memory for the life of the
  session and has no restore API; the diffs carry context lines, not whole files. Stays
  unsupported.
- **Goals** (`dsh-goal`, `dsh-command-goal`). The services are mounted for the presets, but the
  harness capability stays `goal: null` — no host surface drives them yet.
- **Background workflows in the status bar.** They are tracked, count as background work and are
  stopped with the session, but dsh's `workflow` tool is not rendered as SuperOne's `Workflow`
  block, so the list has no row for them.

## 5. Outcome

### Gates

- `packages/deepseek`: `tsc` clean; `vitest run` — 210 passed (sandbox off: tests bind
  localhost, spawn git, and watch the filesystem).
- `bun run typecheck:node` / `typecheck:web` — clean.
- Desktop suites touched by the change (dsh backend and its interaction / background files,
  session, agent-service, app settings, preferences, dsh main) — green.
- Packaged `build:mac-dev` booted the runtime through CDP: both models listed, four presets,
  72 bundled plugins; the asar import scan found no missing specifier.
- Migration: all 40 local dev sessions read, 9 resumed/forked and ran a mock turn.

### Not verified

- **No live DeepSeek API turn** was run — the upgrade was verified with a scripted adapter only.
  Run one real session (text, tool call, background subagent, plan approval) before release.
- The Linux/Windows subprocess-runner patch and the Windows PTC fallback are untested on those
  platforms.
