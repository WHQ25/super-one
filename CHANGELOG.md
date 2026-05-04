# Changelog

All notable changes to SuperOne are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [0.27.1-alpha] - 2026-05-05

### Fixed

- **Usage stats**: Claude token counts no longer balloon as a session grows. The SDK reports cumulative usage per turn; the old code summed each turn's cumulative value, inflating totals quadratically. Now writes only the per-step delta.
- **Usage stats**: Sessions / messages counts no longer collapse when sessions are deleted. Counts are now recorded as events into a new `activity_daily` table at the moment a session/message is first saved, independent of whether the chat history is later removed.

### Changed

- **Usage stats backfill bumped to v2**: on next launch, `usage_daily` is cleared and recomputed from chat history (Claude as per-session per-model cumulative max, Codex as sum-of-step), and the new `activity_daily` table is filled from existing sessions and messages. Numbers in Settings → Usage will adjust on first open after this update.

## [0.27.0-alpha] - 2026-05-05

### Added

- **Mini-app microphone & camera permissions** — mini-apps can declare `permissions.media: [microphone | camera]` in the manifest and use standard `navigator.mediaDevices.getUserMedia`. Grants are gated by the manifest, dynamically applied to iframe sandbox/allow attrs, and surfaced in the install dialog, settings detail page, and a host-rendered recording indicator that clears deterministically when tracks end.
- **Per-day token usage stats** — new Settings → Usage tab shows token usage with Today / 7d / 30d / 90d / All presets and harness filter. Charts switch by preset (horizontal bars, grouped/stacked bars, stacked area, GitHub-style heatmap). Includes summary cards (Total Tokens / Sessions / Messages) and a by-model breakdown. First launch backfills from existing chat history.
- **Claude hooks settings UI** — new settings page for editing `settings.json#hooks` across user / project / local scopes. Supports all 5 SDK hook types (command, prompt, agent, http, mcp_tool) with type-specific fields and a shared advanced section. Writes take effect on the next session start. Codex tab is hidden since Codex has no hook system.
- **Shared Textarea primitive** — new component matching the Input visual language; consolidates ad-hoc `<textarea>` elements across dialogs.

### Fixed

- **Language switch toast now appears in the new locale** — the toast captured `t` via `useTranslation`, which bound it to the pre-switch language, so the success toast appeared in the previous language.
- **Removed double focus ring on project selector dropdown** — the global `:focus-visible` 3px ring overlapped with the accent highlight; only the bg-accent remains.

### Changed

- **Quieter input focus ring** — Input and Textarea focus-visible rings drop from 3px (with border tint) to a subtle 1px ring, matching older hand-rolled inputs. Less visual noise in form-dense dialogs.
- **Bumped `@anthropic-ai/claude-agent-sdk` to 0.2.126.**

### Tests

- Storybook coverage expanded: stories for all chat tool-call UIs, regrouped by harness ownership (Claude vs Codex vs shared), plus CopyableMarkdown stories for chat markdown rendering.

## [0.26.0-alpha] - 2026-05-04

### Added

- **Multi-color subagent indicators** — each Task subagent picks a color from a per-session 8-color pool (purple/blue/cyan/teal/green/amber/orange/rose) so concurrent subagents stay visually distinct. `SubagentBlock` dyes its bot icon, type tag, activity strip, and scroll-area border accordingly; the pool recycles once exhausted.
- **Codex generated images visible on mobile** — desktop converts Codex `image_generation` thread items into `codex_image_generation` content blocks and serves the underlying file to mobile via either an HMAC-signed LAN URL (60s TTL) or a relay R2 upload, depending on transport. New `read_desktop_file` remote command enforces auth + size limits.
- **Codex permission preset descriptions** — `CodexPermissionSelector` and `AutomationDialog` now show what each preset actually does (sandboxed run vs full machine access) via the existing `defaultDesc` / `fullAccessDesc` i18n keys.

### Fixed

- **Subagent color no longer reverts to purple after task completes** — completed subagents had their color released back to the pool, making the selector fall back to the default purple. Colors now persist for the lifetime of the session and apply to history-loaded tasks too.
- **Mobile no longer drops LAN-delivered remote events** — LAN frames now carry the same monotonically increasing `seq` field as relay frames, so mobile's seq filter no longer silently discards everything coming through LAN transport.
- **Mobile-driven Codex sessions correctly identified** — `remote_session_start` now propagates `harnessId`, so the renderer tags codex sessions instead of falling back to the default Claude harness.

### Tests

- Added LAN frame seq monotonicity / reset-on-stop tests, presence-coordinator `harnessId` propagation tests, chat-store `sessionProvider` derivation tests, and a Playwright e2e launch smoke test.

## [0.25.1-alpha] - 2026-05-03

### Fixed

- LAN device discovery no longer spawns the `dns-sd` CLI; uses an in-process bonjour client instead, improving reliability of mDNS advertisement and discovery on macOS.

### Changed

- Removed focus-visible ring on chat input fields and textareas for a cleaner appearance.

## [0.25.0-alpha] - 2026-05-03

### Added

- **Codex generated images render with fullscreen preview and download** — Codex `imageGeneration` thread items now render as a thumbnail; clicking opens a Dialog with pan/zoom, a download button, and prompt + dimension info. Two new IPC channels (`read-file-as-data-uri`, `save-file-as`) load and export the saved file. Path-security checks were also expanded to allow reading from `~/.cache/codex-runtimes/` so Codex bundle artifacts load correctly.
- **Codex computer-use approvals via MCP Elicitation** — Codex's macOS computer-use feature uses `mcpServer/elicitation/request` to ask "Allow Codex to use Google Chrome?"-style permissions. The previous code did not recognize this method, and the fallback empty response was interpreted by Codex as an implicit decline — every computer-use tool call failed silently. Requests are now wired through `PermissionPrompt` with risk icon, subtitle, Allow / Always allow / Decline / Cancel, and a minimal JSON Schema form renderer for string / number / boolean / enum fields. Responses serialize as `{ action, content, _meta }` with `_meta.persist: 'always'` for always-allow.
- **Keyboard shortcuts for image preview** — `=` / `+` zoom in, `-` / `_` zoom out, `0` reset, arrow keys pan. New `usePreventFocusSteal` hook stops pointer-induced focus retention on toolbar buttons so the focus ring no longer lingers after keyboard interaction.
- **One-click sync for legacy providers** — when a stored provider config has drifted from its preset (missing fields, stale model ids, etc.), `ProviderDialog` and the `ProvidersPage` row both surface a sync icon. Opening `PresetSyncDialog` shows per-field added/changed lists with checkboxes — added entries default ON, changed entries default OFF (you opt in to override your own values). `base_url` and changed fields are only touched when explicitly checked. DeepSeek preset bumped to V4 Pro / V4 Pro 1M / V4 Flash with subagent slot.

### Changed

- **Oversized image attachments downscale to 2000px max side** — images whose long side exceeds Claude's 2000px limit are now resized before being base64-encoded. PDFs keep the existing FileReader path; decode/encode failures fall back to the original file so attachments never disappear.
- **Window minWidth adapts to visible panels** — sidebar and activity panel each have their own min width; the previous hardcoded 1080 was the all-three-open sum, leaving the window stuck at that floor even when panels were collapsed. The renderer now computes the floor from current panel visibility, pushes it to main via IPC, and grows the window (clamped to display work area) when the new floor exceeds the current size.
- **Unified focus-visible ring on non-shadcn elements** — a single `:focus-visible` rule in `@layer base` produces a 3px ring at 50% `--ring` opacity. Tailwind utility specificity keeps shadcn's per-component focus styles winning, so the rule only paints over the gap (native button, `tabIndex` divs, Tiptap) without disturbing variant or aria-invalid overrides. The Tiptap editor is opted out via `.tiptap:focus-visible` so the chat input no longer gets a 3px brand ring as soon as you start typing.
- **Throwaway SDK probes no longer leave stub session files** — `CONNECT_CLAUDE`, `fetchModels`, and `PROVIDERS_TEST` spawn one-shot SDK queries solely for metadata or connectivity tests; they now pass `persistSession: false` so they no longer leave un-resumable jsonl stubs in `~/.claude/projects/`.

### Fixed

- **Provider connection-test env isolation and timeout** — the test SDK call now uses a 17-key system-env allowlist (PATH / HOME / TMPDIR / Windows essentials) instead of `{...process.env, ...env}`, so shell-leaked `ANTHROPIC_*` / `OPENAI_*` / `CLAUDE_*` no longer bleed into the test. The SDK query loop is wrapped in a `Promise.race` with a 15s timeout (raised from the initial 8s after some legitimately slow first-token responses), and the subprocess is always closed in `finally` so api_retry storms (e.g. provider 401/429) no longer hang the UI for 40+ seconds.

## [0.24.2-alpha] - 2026-05-02

### Changed

- **`/clear` now resets the session locally instead of forwarding to Claude** — typing `/clear` (or selecting it from the slash popup) starts a fresh session in the same panel, matching the "New Session" button. Previously the command was sent to the Claude SDK with no local effect. Strict match only — `/clear something` still goes to the SDK as before. Implemented as an extensible interception table, so future SDK commands (e.g. `/compact`) can be redirected to local actions with a one-line registration.
- **Mini-app dev workspace can now live anywhere** — `setup_mini_app_dev` takes a user-picked `directory` and a `scope` of `project` or `user` (replacing the old standalone mode); SuperOne's install slot under `~/.superone/apps/<id>/` keeps its source location via a new `.s1-dev.json` pointer. `.s1app` upgrades preserve `.s1-dev.json` and the app's `data/` folder so user storage survives dev rebuilds, and only the freshly-scaffolded app opens after setup (no more re-opening every existing dev app).

### Fixed

- **mDNS advertiser no longer outlives desktop quit** — `dns-sd` subprocess is now killed via two layers so mobile reliably sees the desktop go offline: `performQuit()` calls `remoteControlService.stop()` for the Cmd+Q path, and `lan-advertiser` registers process-level `exit`/`SIGINT`/`SIGTERM` hooks for the `bun run dev` Ctrl+C path and crashes where `before-quit` never fires. Previously an orphaned `dns-sd` child would keep broadcasting and pin the device as `onlineLan` on mobile.

## [0.24.1-alpha] - 2026-05-01

### Added

- **Mobile `/add-dir` parity** — full `additionalDirectories` management is now exposed to mobile via new RemoteCommands (`list_directory_for_add_dir`, `validate_add_dir`, `add/remove_project_additional_dir`, `set_session_additional_dirs`); `create_session` also carries `additionalDirectories` from the start. An `additional_dirs_changed` agent event broadcasts every change so renderer + all mobile peers stay in sync. The add-dir popup overview is reorganized into USER (conditional) / PROJECT / SESSION groups with folder chip ↔ path layout, and `BackendCommand` gains `claude.set_additional_dirs` so `Session` handles dir replacement + idle-rebuild uniformly.
- **Chat input focus auto-restored after prompts** — when a permission request, plan approval, or AskUserQuestion appears mid-typing, the prompt steals or absorbs key events and previously left ChatInput unfocused after dismissal. A new per-session `chatInputRestoreFocusNonce` (distinct from the existing focus nonce that jumps cursor to end) restores the editor's saved ProseMirror selection so the cursor returns exactly where typing was interrupted. Multi-prompt sequences only restore once at the end.

### Changed

- **`get_system_info` split into connection-only + `get_project_resources`** — skills, agents, and project slash-commands moved out of `get_system_info` into the new `get_project_resources`, which also returns `additionalDirsScoped` + `cwd` + `homedir` so mobile can render dir hints and shortened paths before `init_ready` arrives. `get_system_info` is now strictly connection metadata, giving mobile a clean separation between cheap connect-time fetch and per-project resource fetch.

### Fixed

- **Skills `argumentHint` reaches mobile** — `listSkills` (used by remote `system_info` / `project_resources`) only parsed `name` + `description` from frontmatter, so every skill row on mobile rendered with an empty argument hint even though the desktop sidebar showed it. `parseFrontmatter` now reads `arguments`/`argument-hint` and propagates `argumentHint` into `SkillInfo`, matching `scanSkillDir`.
- **`@` mention popup auto-hides on zero results** — popup previously stayed open until you typed a space, even if no matches existed for the query. It now closes the moment a search returns zero results and reappears on backspace as soon as the query matches again.

## [0.24.0-alpha] - 2026-05-01

### Added

- **`/add-dir` slash command with inline path completion** — typing `/add-dir [project|session] [path]` in chat input now opens an in-input popup that walks you through scope picker → path picker, supporting relative, absolute, and `~` paths. Candidates are validated server-side (rejects not-found, not-directory, same-as-project, and same-repo worktrees) with a sonner toast on rejection, replacing the modal-only `DirManagerPanel` trigger.
- **Additional directories follow Claude CLI scope conventions** — `additionalDirectories` is now read from all three Claude scopes (`~/.claude/settings.json`, `.claude/settings.json`, `.claude/settings.local.json`) at both top-level and `permissions.*` paths, then merged for the SDK option. Writes converge to `permissions.additionalDirectories` in `.claude/settings.local.json` to match Claude CLI's default `add-dir` target. New session screen also shows a hint row above the chat input listing every scoped dir as a basename chip with tooltip.
- **Codex chat slash menu shows user prompts + project skills** — `/` menu in Codex sessions now merges hardcoded utility commands with `~/.codex/prompts/*.md` (top-level only, per official docs) and per-project skills returned by `codexListSkills(cwd)`. Cached in a new `_codexSkills` map, refreshed on `switchProject` and `setPreferredProvider('codex')`.
- **Mobile slash menu also receives Codex user prompts** — desktop's `get_system_info` Codex branch now appends cached `CodexResources.prompts` to the slash-command list it sends mobile, so the iOS/Android slash menu lists the same `~/.codex/prompts/*.md` entries the desktop sees. No mobile-side change needed (existing payload field already accepted).

### Changed

- **Per-harness resource architecture with lazy init** — global resource cache is split into per-harness `ClaudeResources` / `CodexResources` types, backed by a new SQLite table `harness_resource_cache` (replacing the flat `global_resource_cache`, with migration). A new `initializeHarness(harness)` action runs once per app session via a `harnessHandlers` dispatch table and is triggered on `continueToMain` (Claude) or `setPreferredProvider` (Codex). New `CONNECT_CODEX` IPC mirrors `CONNECT_CLAUDE`. Renderer reads now go through selector helpers (`selectClaudeModels` / `selectCodexModels` / ...) instead of direct field access. Fixes a Codex per-session model-sync regression along the way.

### Fixed

- **Denied / errored tool blocks hover with status color, not gray** — hover state was unconditionally applying `bg-muted/70`, washing out the red/amber tint on denied or errored tool rows. Hover class is now bound to status (`red-500/20` for denied, `amber-500/20` for errored), matching the badge swatches already shown in the same row.
- **Insight blocks render even with heading-wrapped header or inline footer** — the `★ Title ───` parser is now tolerant of an optional markdown heading prefix (`## ★ Title ───`) and of footers fused with the final content line (`Last line ─────`). Both forms are common in real model output and were previously falling through as plain text. Fix applied identically to the main-process splitter and the renderer markdown splitter.

## [0.23.2-alpha] - 2026-04-30

### Added

- **Per-skill toggle to hide skills from Claude** — each skill row gains a switch that lets you disable specific skills from running Claude sessions without uninstalling them. State persists in `agentPreference.claude.disabledSkills` and is applied via Claude Agent SDK 0.2.122's `skills` option. Plugin-provided skills can also be toggled (deletion remains gated by plugin uninstall).
- **AskUserQuestion descriptions render inline** — option descriptions now appear in a fixed insight-style band below the "Other" input the moment you select an option, replacing the unreliable native `title` tooltip. Light-mode accents follow the per-harness brand hue; dark mode keeps the original blue via `dark:` variants.
- **Plan approval offers Auto Mode when supported** — the post-approval permission target swaps from "Switch to Accept Edits" to "Switch to Auto" when the active account + model are eligible for Auto Mode, with the approve button restyled (amber + Zap icon) to match.

### Changed

- **Unified Codex + Claude session-control IPC** — interrupt, reset, permission-response, answer-question, and dismiss-question now route through a single `agent:*` channel keyed by `sessionId`, dropping the parallel `codex:*` plane. `Session.interrupt()` returns boolean and runs an injected `onBeforeInterrupt` hook, so widget-gate + mini-app pending-call cleanup happens once inside the Session abstraction instead of being duplicated at the IPC layer for Claude only.
- **Mobile remote protocol splits `create_session` from `send_message`** — mobile clients now generate the session id and call `create_session` first (which owns worktree path/branch, gitBranch checkout, and session registration), then `send_message` carries only content to that existing session. Removes the previous `switch_worktree` RPC since worktree selection is now part of `create_session`. Adds `clearPendingWorktree` to drop incomplete pending state when the worktree popover is dismissed without naming a branch.
- **Codex SDK 0.124.0 → 0.125.0** — `codex-plugins-service` adapted to handle remote marketplace plugins that have no local `sourcePath` (only installed plugins read manifest/files from disk). Vitest `localStorage` stub hardened so 0.125's import-time `setItem` probe doesn't crash on bare `globalThis` stubs.
- **Dockview theme driven by design tokens** — dockview CSS variables now read SuperOne theme tokens directly, so harness brand hue and per-token LCH overrides flow into panel chrome.
- **Detached worktree chip drops `@` prefix** — desktop trigger label and mobile chip now render as `Worktree {hash}` instead of `Worktree @{hash}`. The leading commit icon already conveys the detached semantics.

## [0.23.1-alpha] - 2026-04-28

### Fixed

- **`border-{token}` utilities now apply token colors** — the global `* { border-color }` fallback was unlayered, so Tailwind utilities like `border-insight-border`, `border-sidebar-border`, `border-primary` were silently overridden into the default border gray (most visibly: chat insight blocks rendered with a gray left bar instead of purple). Wrapping the fallback in `@layer base` lets each utility's own color win. The New Session button is pinned to `--border` in dark mode to preserve its previous look.
- **Mini-apps follow live theme changes** — the iframe bridge previously only re-sent theme vars on dark/light toggle, so brand hue tweaks, per-token LCH overrides, and harness switches were not reflected in running mini-apps. The bridge now observes inline-style mutations on `<html>` and pushes a fresh theme snapshot whenever host CSS variables change.

## [0.23.0-alpha] - 2026-04-28

### Added

- **Three-mode worktree flow with semantic indicator** — `WorkDirIndicator` popover redesigned into Local / Existing worktrees / Create new from sections, with a segmented New branch / Attach / Detach control inside the pending panel. New branch mode requires a name with inline duplicate-branch detection (offers a "Switch to Attach" affordance); Attach hides itself when the base is already checked out elsewhere. Worktree directories now name as `~/.worktrees/<repo>/<base36-epoch>-<short-hash>` for chronological ordering. Indicator label is semantic with inline icons via `<Trans>`, so language reordering keeps icons in the right slot. New IPC: `GIT_SWITCH_WORKTREE` (one-click switch to existing), `GIT_CHECKED_OUT_BRANCHES` (attach availability check). "Carry local changes" is hidden when the main repo is clean.
- **Per-harness brand hue picker in light mode** — palette popover in the sidebar lets you shift the whole app's color temperature by hue. Each harness (Claude / Codex) persists its own hue in `app-settings.json`; dark mode is unaffected.
- **Per-token LCH override with advanced editor** — extend brand theming from a single hue to layered LCH+alpha overrides per design token. Basic mode keeps the hue slider; Advanced mode swaps in a 2D L×C area, hue strip, alpha strip, and L/C/H/A inputs. Default brand hue unified to 240° for both Claude and Codex harnesses. CSS tokens migrated to `var()` fallback chains so changes ripple via single `--brand-hue` or per-channel vars without JS-side `setProperty` fan-out.

### Fixed

- **Light-mode contrast for chat, sidebar, and diff surfaces** — Tailwind `text-X-400` shades are tuned for dark backgrounds and turn illegible on the warm cream palette. Migrated to the dark-aware pair `text-X-600 dark:text-X-400` across chat blocks, sidebar status icons, git status colors, drop-zone borders, diff markers, and the file dirty indicator. Also replaced hardcoded `text-white` / `border-white/N` / `bg-white/N` in chat message chips with semantic foreground tokens so they invert correctly on theme switch.
- **Worktree indicator locks to read-only on hydrated or active sessions** — the indicator now refuses to mutate the working directory once a session has loaded messages or the SDK session is up, preventing mid-stream cwd drift. The "is old session" heuristic also switched to messages count + SDK session, fixing edge cases where the lock fired or relaxed at the wrong moment.

### Changed

- **Worktree operations centralized into a dedicated module** — `src/main/git/worktree-ops.ts` is now the single home for worktree create/attach/detach/switch logic, replacing scattered call sites in `agent-service.ts` and `index.ts`. The remote protocol (`agent-types.ts`) gains the corresponding worktree commands so mobile clients can drive the same flows.
- **Pinned session row simplified to two-line text layout** — sidebar's pinned sessions drop the avatar/preview clutter for a cleaner two-line text presentation.

### Performance

- **Codex app-server connection cached for prewarm reuse** — the Codex prewarm path now reuses an existing app-server connection instead of dialing a fresh one each time, cutting cold-start latency on first message.

## [0.22.4-alpha] - 2026-04-27

### Added

- **Right-click selection to quote into prompt** — select any text in chat (markdown, user messages, tool blocks) and right-click to copy or "add to chat". Quoted selections accumulate as a chip in the input bar and are wrapped in `<quote>...</quote>` XML on send. Codex shares the same path via a unified `buildUserMessage`. Mini-app context chips also moved below the user bubble and adapt to dark mode.
- **Pasted-text chip rendering survives reloads** — `ContentBlock.text` gains an `isPaste` flag, so historical messages always render long pastes as `LongTextChip` regardless of length heuristics.
- **Recent folder list keeps a stable order** — sidebar's recent projects no longer reshuffle on every activity update; new entries prepend, existing ones hold position until the user toggles sort mode.
- **Project rows expand sessions incrementally** — initial render shows 5 sessions per project with a "Show more" / "Show less" toggle for the rest (up to 10), plus a shortcut to full history.
- **Mobile-connect toast** — desktop shows a top-center toast only on a mobile device's first connect, not on transport switches (LAN ↔ relay).
- **Diagnostic traces for mobile routing** — `remote.broadcast` and `session.lifecycle` are now recorded in `event-trace.db`, making it possible to query a single timeline of emit → route/drop → reached-transport alongside ownership/subscription churn.

### Fixed

- **Mobile reasoning no longer renders after the answer** — short thinking deltas were getting flushed after text on `message_complete`, displaying reasoning below the visible response on mobile. The broadcaster now flushes the opposing buffer when content type switches, preserving emit-time order.
- **Mobile gets session metadata on cold-subscribe** — `subscribe_session` against a freshly-constructed session was missing the synchronous `init_ready` event (skills, agents, permission mode, etc.) because it fired before subscribers were attached. Cached replay events are now forwarded to the new subscriber.

## [0.22.3-alpha] - 2026-04-26

### Fixed

- **Mobile viewers no longer get kicked when desktop hits Stop or +** — INTERRUPT and the "+" new-session button used to clear `subscribers`, ejecting any phone watching the session. Both now respect that mobile subscription is an independent viewer mode that should outlive a single streaming run; the mobile-subscribed session is parked instead of disposed when the user starts a new session.
- **Multiple mobiles no longer cross-talk** — agent events for session A used to fan out to every connected mobile regardless of which session each had subscribed. Events now route by per-subscriber/owner deviceId so phone B watching session Y never receives session X's stream.
- **Cross-mobile response leak** — when N mobiles shared a desktop, a `list_directory` (or any request) response broadcast to every mobile, exposing one device's command results to another. Desktop now tags responses with `mobileDeviceId` and the relay routes by it.
- **`subscribe_session` no longer hijacks desktop's active session** — when a mobile subscribed to a cold session in a project where desktop had a different active session, the resume path overwrote `activeByProject` and swapped desktop's view out from under the user. The subscription path now resumes passively without touching the active pointer.
- **`session_disconnected` no longer flashes when the user just switches sessions on mobile** — the previous heuristic ("device is elsewhere") fired during normal navigation and showed mobile a misleading "disconnected" state. Replaced with explicit reason-tagged lifecycle events (`self_leave` / `self_switch` / `desktop_kick` / `transport_disconnect` / `session_closed`) so each scenario gets the correct mobile UX.
- **Mobile re-subscribe to a cold session works** — `subscribe_session` was failing with `session_not_found` for sessions saved to DB but not in memory. The handler now resumes them on demand.
- **Desktop is read-only while mobile is subscribed, not just owning** — locking previously triggered only when a remote `owner` existed; mid-streaming of a mobile-viewing session, the desktop's input stayed enabled and would clobber the remote turn. Lock now also fires when `subscribers.size > 0`.
- **Empty subscribers during dispose no longer drops shutdown events** — `Session.dispose()` cleared subscribers before `backend.close()`, so any event the backend emitted during shutdown couldn't reach mobile viewers. Reordered: backend closes first, then subscribers/owner reset.

### Added

- **Persistent mobile claim** — once a mobile takes ownership of a session (by sending a message), the claim survives until that mobile explicitly leaves, unsubscribes, disconnects, or the desktop kicks it. Claim no longer auto-releases at the end of each turn; Codex and Claude paths share this contract.
- **Second-mobile attempts rejected at subscribe time** — previously a second phone could enter the session view and only fail when it tried to send. The subscribe handshake is now request/response so the second phone gets `session_locked` synchronously and never enters the session UI.
- **`subscribe_session` auto-releases the device from any other session** — switching a mobile to a different session no longer leaves its old subscription / ownership lingering.
- **`leave_session` protocol** — explicit mobile→desktop frame for "I'm leaving this specific session" without disconnecting the device, used when mobile navigates out of a session view.

### Changed

- **Session ownership API tightened** — `Session.claim()` is type-narrowed to remote ownership only; `LOCAL_OWNER` is the initial state and `release()` is the only path back. The previous "claim local" bypass that skipped conflict checks is gone.
- **Mobile lifecycle dispatch centralized in `PresenceCoordinator`** — owner_changed / subscriber_added/removed / closed events are mapped to the right mobile-facing frame (`session_kicked` / `session_closed` / `session_locked_by_other_device`) by reason, replacing scattered heuristics in the IPC handler walls.

### Tests

- **Regression coverage**: INTERRUPT does not unsubscribe subscribers; `subscribe_session` resume uses `{ passive: true }` so desktop's active session pointer isn't disturbed; `Session.dispose()` lifecycle events tagged with `reason: 'session_closed'`; multi-session ownership isolation; second-mobile rejection at subscribe time.

## [0.22.2-alpha] - 2026-04-25

### Fixed

- **Desktop sending no longer hangs after a mobile leaves a Claude session it created** — a mobile-initiated Claude turn left the desktop locked in a "controlled remotely" state after the turn finished (the Codex path had finally-cleanup; the Claude path did not). When the mobile later unsubscribed, desktop messages were rejected. Both paths now share a single ownership-lifecycle helper, and the lock releases the moment the remote turn ends.

### Changed

- **Session ownership is a first-class property of each Session** — `owner` (local / remote+deviceId), `subscribers` set, and lifecycle events live inside the Session itself; ownership locking is enforced inside `Session.send()` rather than by scattered IPC-handler guards. Transport (`RemoteControlService`) is reduced to a pure relay+LAN frame layer with no session-control state.
- **Multiple mobile devices can share one desktop** — paired with the upgraded relay, a single desktop channel now hosts an arbitrary number of mobile peers, each tagged with its own deviceId. Sessions are independently owned and viewed; one device disconnecting only affects the sessions it owned or subscribed to.
- **`unsubscribe_session` accepts an optional `sessionId`** — mobile targets a specific session instead of clearing every subscription this device holds; cleaner semantics for multi-session viewing.

## [0.22.1-alpha] - 2026-04-25

### Added

- **Sidebar tooltip lists online mobile devices with their transport** — hovering the remote indicator shows each connected device and whether it's joined via LAN or relay.
- **Permission mode, thinking effort, model, and active provider sync to mobile** — desktop now pushes the full session control surface so the mobile chat picker reflects the desktop state.
- **`get_system_info` returns user agent defaults** — mobile clients receive Claude/Codex default model and effort from desktop preferences on first connect.

### Fixed

- **Effort change mid-session now takes effect on next send** — switching thinking effort via `setSelectedSettings` previously updated the field but did not flag the backend for rebuild, so the next message reused the stale effort. The session now marks itself for rebuild and the new effort is applied on the very next send.
- **Remote-controlled turns broadcast session start and clean up ownership** — when a mobile client started a remote turn, the desktop UI did not receive a `remote_session_start` event and the remote-owned flag stayed set after the turn ended. Both are now emitted/cleared correctly, and the remote lock also covers the active remote-owned session even without an active subscription.
- **Device stays online while any transport is connected** — closing one of LAN/relay no longer flips a device offline when the other connection is still live; transport tracking is now per-connection rather than overwriting on each new join.
- **Session lock releases when mobile unsubscribes without disconnecting** — switching projects on the mobile side previously left the desktop session locked even though the subscription was gone.
- **Table and `★ Insight` blocks survive mid-stream flush** — chat content reducer no longer drops these block types when streaming events flush partial text.

### Changed

- **Model picker drops provider icon prefix** — both the model selector trigger and the picker list show the model name only, matching the cleaner mobile layout.

### Tests

- **i18next initialized in vitest setup** — tests pulling in modules that touch shared i18n resources no longer warn about uninitialized i18next.
- **Coverage for `provider-utils`, `get_system_info` defaults, and model lists** — locks down the desktop→mobile metadata surface.

## [0.22.0-alpha] - 2026-04-24

### Added

- **Host locale exposed to mini-apps via `superone.locale` API** — mini-apps can now call `superone.locale.get()` and subscribe to changes via `superone.locale.onChange()` to follow the user's UI language (en/zh). Initial value is baked into the bridge at load time (iframe: inlined at script generation; webview: read from `_locale` query param in preload) so there's no race window between app start and the first locale read. Listeners only fire on actual diffs.
- **Expanded zh/en coverage across chat UI** — tooltips, permission/plan/ask-user prompts, sidebar context menus, tool block and subagent status text, rewind and worktree popovers, Codex slash commands, and model/permission selectors are now fully translated.

### Fixed

- **Advanced env editor preserves reserved provider keys** — `parseEnvPairs` / `serializeEnvPairs` previously dropped `RESERVED_ENV_KEYS` (auth token, model buckets, base_url) both on read and write, so any preset with an `ANTHROPIC_AUTH_TOKEN` sentinel (Z.ai, DeepSeek, DMXAPI, …) lost the sentinel after you edited and saved advanced env vars, which broke auth because `buildProviderEnv` then couldn't copy `api_key` into `ANTHROPIC_AUTH_TOKEN`. The editor now splits state into visible + hidden pairs so reserved keys stay in the data layer but out of the UI, and serialize guards against user-typed collisions.
- **Automation/schedule dialog no longer shows raw i18n keys** — automation/schedule translation keys live under `resources.*` but the dialog was calling them with a `settings.*` prefix, so strings like `"settings.automation.createTitle"` rendered verbatim. Fixed by correcting the namespace.

### Changed

- **Structured `model_env` with bucket slots and display names** — provider model configuration moves from flat `ANTHROPIC_DEFAULT_*_MODEL` env strings to typed `ProviderModelEnv` keyed by stable buckets (`default` / `opus` / `sonnet` / `haiku` / `subagent`), each slot carrying `{id, name, description}`. ProviderDialog gains a dedicated Model Env editor for the 5 bucket slots. ModelSelector now shows the provider icon plus the bucket-derived display name, with dedup by `slot.id`, and hides the effort selector for non-official providers unless `CLAUDE_CODE_EFFORT_LEVEL` is set (then rendered as a read-only label). An idempotent DB migration hoists legacy flat env into the new structure on first launch.
- **Preset model versions bumped** — `kimi-k2` → `kimi-k2.6`, `MiniMax-M2.5` → `MiniMax-M2.7` (CN / Global / SiliconFlow), `mimo-v2-flash` → `mimo-v2-pro`.
- **`@openai/codex-sdk` updated to 0.124.0**.

## [0.21.11-alpha] - 2026-04-24

### Added

- **Language switching (zh/en) in Settings → Preferences** — full internationalization across settings and chat UI.
- **Streaming tool input previews for Edit/Write/FileChange/NotebookEdit** — tool arguments render progressively as they stream, so long Edit/Write calls show their target file and partial content immediately instead of waiting for the full JSON.
- **Error tool results auto-collapse** — tool blocks whose result is an error collapse by default, keeping chat scrollback clean while staying one click away.

### Fixed

- **Chat layout no longer overflows on narrow widths** — a missing `min-w-0` on the layout flex chain let long tool output push the chat column wider than its container. The chain now contains its content.

### Changed

- **Claude Agent SDK updated to 0.2.118** — brings parity with Claude Code CLI through v2.1.118 (rolls up v2.1.115–v2.1.118 upstream updates).
- **Settings preferences reuse chat list components** — internal refactor, no behavior change.

### Performance

- **Per-project syntax highlighter cache** — code highlighting in diffs reuses a cached shiki instance per project instead of rebuilding per tool block; caches are disposed when the project closes.
- **Incremental line-level highlighting for the streaming Edit diff** — CanvasEditDiff only re-highlights lines that actually changed, rather than the whole file, on each streaming delta.
- **Common languages preloaded at app boot** — TypeScript / JavaScript / Python / Markdown / JSON highlighters load during startup so the first Edit tool doesn't wait on highlighter init.
- **Streaming JSON parser rewrite** — `partial-json` string extractor replaces O(n²) character-by-character concat with an array accumulator plus a fast no-escape slice path.

## [0.21.10-alpha] - 2026-04-23

### Added

- **Direct LAN transport for mobile clients** — mobile devices on the same WiFi now connect directly to the desktop via a local WebSocket server with mDNS zero-config discovery, bypassing the Cloudflare relay for lower latency. The relay stays available as automatic fallback when off-WiFi. End-to-end encryption reuses the existing per-pair AES-GCM key, so existing pairings keep working without re-pairing.
- **Per-agent default preferences in Settings → Preferences** — Claude gains Default Model + Default Thinking Effort selectors alongside the existing Permission Mode and Sandbox defaults. Changes apply to every session that has not explicitly picked its own model, and the settings live in `app-settings.json` under `agentPreference.claude` so they survive across Claude CLI upgrades.
- **Live streaming diff for the Edit tool** — Edit tool calls now render a canvas-based diff that animates line-by-line as `old_string` → `new_string` arrives, with cursor tracking and a cross-fade from pre-edit to full diff when `new_string` begins streaming. This replaces the previous plain diff rendering during streaming.
- **Renderer resyncs with live main-process sessions after reload or crash** — reloading the renderer (or recovering from a renderer crash) mid-stream used to drop the in-flight session. The renderer now buffers incoming events while it pulls a live snapshot from the main process, replays the snapshot into the store, then flushes the buffer in order. Events carry a process-wide `(epoch, seq)` tuple so replays and reorderings are deduplicated at the reducer level.
- **Paste chips are editable and unfoldable** — each paste chip in the chat input now exposes an unfold action (expands the chip back into inline paragraphs) and its preview dialog became a lightweight textarea editor that writes edits back to the chip in-place.

### Fixed

- **Edit tool's `+N -N` line count now matches the real diff** — the counter used to sum `old_string` / `new_string` line counts naively, so a one-line change reported `+5 -5`. It now uses the same `diffLines` LCS that `FileChange` uses and returns `null` when the two sides are identical.
- **Codex turn/steer no longer hangs for 15 seconds** — a single-reader dispatcher on the app-server connection would silently drop the steer JSON-RPC response if a turn was parked in `nextNotification`, so `request()` waited for its 15s timeout. Responses and notifications now route through per-id waiters and a shared queue respectively.
- **Switching Codex auth providers rebuilds the connection with the new env** — `CodexBackend.rebuild()` previously left the cached app-server running with stale auth, so the next turn kept using the old API key / base URL. The connection is now torn down whenever auth rotates or the session needs a rebuild.
- **Codex permission Cancel is no longer collapsed into Decline** — the `decision='cancel'` flag was dropped between the IPC handler and the backend. The decision now threads through `SessionContract.respondToPermission` unchanged.
- **Codex interaction IPC handlers return their result** — `respondToPermission` / `answerQuestion` / `dismissQuestion` now propagate their ack back to the renderer instead of resolving as `undefined`, so stale-click protection works against Codex the same way it does against Claude.
- **Collapsed skill cards fill their row height** — skill cards now use a flex column layout so collapsed cards stretch to match the tallest card in the row.

### Performance

- **Codex reuses the app-server subprocess across turns of the same session** — `run` / `review` / `compact` used to spawn, initialize, and tear down a fresh `codex` subprocess on every message, adding roughly 1–2 seconds of overhead per turn. Each session now caches its `AppServerConnectionHandle` and only respawns on `reset()`, auth change, model/effort/thread reconfiguration, or child-process exit. `CodexBackend.prewarm()` also spawns the subprocess ahead of the first turn, mirroring the existing Claude warmup.

## [0.21.9-alpha] - 2026-04-22

### Fixed

- **Permission mode stays in sync after the "Switch to acceptEdits" suggestion is applied** — when the CLI applied the mode switch directly (bypassing our setPermissionMode IPC), the session's cached mode went stale, so switching back to `default` was treated as a no-op and the next edit would auto-approve. The backend now forwards session-scoped setMode suggestions from `canUseTool` so `Session.permissionMode` updates and the renderer receives a `permission_mode_change` event.
- **Context usage no longer bleeds between sessions that share a model** — the token count and category breakdown are now stored per-session and cleared on session switch instead of only on model change. `getContextUsage` is addressed by `sessionId` end-to-end, closing the reverse race where an in-flight fetch for session A could return session B's usage after a switch.
- **Mention chips insert with correct spacing** — a chip inserted directly after non-whitespace text was serialized without surrounding spaces (e.g. `abc@hello.py`), which the user-bubble parser's mention guard then rejected. The mention atom is now self-contained with leading/trailing spaces in both the serializer and rendered text.
- **Insight blocks wrapped in code fences render as insights** — models sometimes emit the star/divider insight block inside a ``` fence, which previously rendered as a raw code block. The splitter now detects and strips paired wrapping fences while leaving unmatched fences untouched so genuine code blocks are preserved.
- **Sidebar session menu "Open Folder" reveals the project in Finder** — the menu item was wired to an IPC that opens the project inside SuperOne (a no-op when already open). It now calls `showInFolder` with an empty relative path, which resolves to the project root and opens it in the system file manager.

### Performance

- **Project switch no longer shows a blank file tree on first open** — `fetchTree` is now triggered fire-and-forget from every `currentFolder` entry point (open folder, switch project, open tmp folder), so the `listDir` IPC overlaps the rest of the project switch instead of starting only when the FileTree component mounts. A root-dedupe field in the file-tree store makes the component's own fetch a no-op.

## [0.21.8-alpha] - 2026-04-21

### Added

- **Live-streaming diff for Edit/Write/FileChange tool calls** — tool blocks now auto-expand and pin their diff view to the bottom while tool input streams in, with syntax-highlighted tokens updating in place as partial JSON arrives. Manual scroll is suppressed during streaming and restored on completion.
- **Background status for tasks still running after the turn result arrives** — when the SDK emits its final result but background tasks are still active, the session stays in a new `background` status instead of flipping to `idle`. The sidebar shows a distinct pulse icon, and "New Session" / session-switch actions correctly park the session rather than killing the subprocess.

### Fixed

- **Adding a folder no longer fails when `git init` fails** — the auto `git init` on project add is now tolerant. Projects without a usable git executable (or with a folder that can't be initialized) still open successfully; the failure reason is written to the main process log.
- **Switching back to a session whose worktree was deleted externally now shows the read-only banner** — `switchSession` used to trust its cached worktree path and silently re-activated a removed worktree. It now probes the path before reuse and flips the session to read-only inline, matching DB-restored session behavior.

## [0.21.7-alpha] - 2026-04-21

### Fixed

- **Permission prompts stuck after switching sessions** — The shared `WarmupManager` let a warm SDK subprocess outlive the backend that created it. When one session disposed and another session's warm slot key matched, the second session consumed the first session's subprocess — whose `canUseTool` closure was still bound to the disposed backend. Permission requests emitted into an empty listener set and the prompt never reached the UI. Each `ClaudeBackend` now owns its own `WarmupManager` and disposes it on close, so warm slots die with the backend that owns them.
- **Permission prompt stays visible when the backend can't resolve it** — `respondToPermission` now returns an ack boolean through the backend → `Session` → IPC → store chain, so if the main process has no pending request for the given id (stale click, session already moved on), the renderer keeps the prompt instead of silently clearing it.
- **Mermaid diagrams render all nodes** — the SVG `foreignObject` coordinate bug that was dropping nodes from rendered Mermaid charts is resolved.

## [0.21.6-alpha] - 2026-04-20

### Added

- **Refresh shortcuts no longer reload the app** in packaged builds — Cmd/Ctrl+R, Cmd/Ctrl+Shift+R, and F5 are intercepted so streaming chat and in-memory state aren't lost. Dev mode is unchanged so HMR reload still works.

### Fixed

- **Sandbox toggle now propagates to the running session** — previously, turning Sandbox Off in the UI left the SDK subprocess on its startup sandbox config, so tool calls kept requesting sandbox permissions.
- **Plan approval now syncs permission mode to main** — approving a plan previously only flipped the UI to `acceptEdits`, while the backend session stayed on the old mode and Edit/Write kept prompting.
- **Resumed sessions honor user default permission and sandbox mode** instead of falling back to `default` + hardcoded sandbox. Main is now the authoritative source; the renderer reflects what main actually applied.
- **Switching in/out of `bypassPermissions` mode rebuilds the backend** — the SDK's `allowDangerouslySkipPermissions` flag is fixed at init, so the session now defers a rebuild to the next `send()`, mirroring the `switchCwd` pattern.

## [0.21.5-alpha] - 2026-04-19

### Added

- **Codex plugins management** — install, list, delete, and browse marketplace plugins per project.
- **Per-project Codex MCP config** — save, delete, and toggle MCP servers scoped to user or project.

### Changed

- **Claude Agent SDK upgraded to 0.2.114** (from 0.2.111), now using per-platform native binaries.

### Fixed

- **Codex child thread events** now route to the correct session instead of being dropped.
- **Packaged app failed to warm up with `spawn ENOTDIR`** — Electron's asar→unpacked path rewrite doesn't cover ESM `child_process.spawn` in this scenario, so the bundled Claude native binary was being spawned from inside `app.asar` and refused by the OS. Fixed by resolving the binary and forcing its `app.asar.unpacked` path at every SDK call site (chat query, prewarm, model list, auth bootstrap, provider test).

## [0.21.2-alpha] - 2026-04-19

### Changed

- **ESC hold-to-interrupt shortened to 600ms** (from 1000ms) for a snappier stop gesture in the chat composer.

### Fixed

- **Queued messages flush correctly after interrupt/cancel** in `ClaudeBackend`, so text typed while the agent was running no longer gets dropped.
- **Mini-app tools reach the SDK on resume** — `markAllNeedsRebuild` now forces a rebuild so dynamically-registered MCP tools are re-applied.
- **Removed-worktree sessions render READ-ONLY** instead of erroring, making it obvious the underlying worktree no longer exists on disk.
- **New sessions inherit user preferences** (model, permission mode, etc.) at creation time rather than only after the first turn.
- **Embedded JS/CSS inside HTML files** now gets proper syntax highlighting in the diff view.

## [0.21.1-alpha] - 2026-04-18

### Fixed

- **Session worktree persistence** — worktree path/base branch now round-trip through save/resume, and resume gracefully recovers when the worktree directory is missing on disk.
- **Prewarm respects permission handler** — the prewarmed Claude subprocess now binds the real `canUseTool`, so edits on the first tool call after warmup are no longer auto-denied.
- **Project-level resource discovery restored for Claude sessions** — per-project agents / skills / MCP configs load again.
- **Slash command palette refreshes on provider switch** — no more stale Claude entries after switching to Codex (and vice-versa).
- **File link targets normalized** before opening, so paths with `./` prefixes, URL-encoded characters, or fragment suffixes resolve correctly.
- **Codex completion metadata** (token counts, finish reason) normalized so post-turn UI doesn't render partial data.
- **Codex bash blocks** now collapse by default with a shimmer "running" state, matching the Claude bash UX.
- **@mention chips render for mid-text mentions** in the user bubble (previously only leading mentions became chips).
- "Accept edits" suggestion in the plan-approval UI is correctly aligned.

## [0.21.0-alpha] - 2026-04-18

### Refactored

- **Session management overhaul** — replaced the monolithic `agent-service.ts` (1600+ LOC) with a hexagonal architecture: `Session` (lifecycle aggregate root), `SessionBackend` (`ClaudeBackend` / `CodexBackend`), `SessionManager` (per-project tracking + event fan-out), `BackendCommand` (generic discriminated-union command bus). Removes ~450 LOC of legacy Codex runtime infrastructure. Stable `sessions.id` is now the primary key; `provider_session_id` is persisted when the harness resolves it.
- **Codex paths unified through SessionManager** — all Codex IPC handlers (`run`, `steer` with hot assistantId swap, `review`, `compact`, plan approval, collaboration mode, side-channel), plus automation service and remote control, now route through the same Session pipeline as Claude.
- **Pure-SQL migration module** — extracted `database-migrations.ts` with no Electron dependency so migrations can run from bare Node for CI / snapshot testing.

### Fixed

- `CODEX_RUN` receiving a Claude session id when the user switched provider to Codex after an empty Claude session — renderer now creates a fresh Codex session id.
- `switchCwd` now actually migrates the active session to the new cwd (previously a silent no-op).
- Live sessions rebuild when provider config changes (previously `markAllNeedsRebuild` fan-out was a no-op).
- Warmup subprocess isolation by resume / fork / session id so parallel projects don't share warm CLI state.
- Streaming reasoning block auto-expands when text arrives after an empty anchor (Brain animation no longer swallowed).
- Chat-md tolerates insight blocks emitted without wrapping backticks.

### Added

- `scripts/test-migration.ts` — copies the production DB, runs migrations against the copy, and asserts schema invariants (provider_session_id backfilled, claude_session_id dropped, session_providers seeded, no orphaned messages). Runs via `bun run test:migration`.

### Styling

- Tightened tool-group vertical margin in chat.

## [0.20.3-alpha] - 2026-04-17

### Added

- Auto Mode in the permission-mode cycle — gated by plan (Max/Team/Enterprise/API), first-party provider, and model support (`supportsAutoMode`); auto-downgrades to `default` when switching to an ineligible model. Don't Ask / Bypass are grouped below a divider and now require an explicit click.
- Pre-warm Claude CLI subprocess on typing / draft changes so the ~3.4s SDK init runs off the critical path. First-response latency on session rebuild drops from ~5.3s to ~1.9s (65% reduction).
- Default effort now uses the model's top tier — Opus 4.7 (and any future model exposing `xhigh`) defaults to `xhigh` instead of `medium`.

### Fixed

- "Thinking..." indicator no longer disappeared with the latest SDK default of `adaptive` + `omitted`. We now request `adaptive` + `summarized` and emit an empty thinking anchor so the Brain animation is always visible, matching the Codex reasoning UX.
- Stale streaming-token footer after interrupting a reply and sending again — the new assistant message briefly showed the previous turn's token count. Session-level `streamingTokens` now resets on `message_start`, freezes into the interrupted message on `message_interrupted`, and clears on `message_error`.

## [0.20.2-alpha] - 2026-04-17

### Fixed

- App crash on startup in packaged v0.20.1-alpha builds with `SyntaxError: Identifier 'require' has already been declared`. Root cause: `resolve-cli.ts` declared a local `require` via `createRequire`, which collided with rolldown's auto-injected CJS shim in the bundled main process output. Renamed to `moduleRequire` to avoid the conflict.
- `CONNECT_CLAUDE` handler no longer wipes `PATH` / `HOME` from the CLI subprocess environment in packaged mode (latent bug, auto-fixed by the SDK upgrade below changing `options.env` semantics from replace to overlay).

### Added

- Claude Opus 4.7 support via `@anthropic-ai/claude-agent-sdk` upgrade (`0.2.101` → `0.2.111`).
- New `xhigh` effort level (surfaced as "Extra High" in model and automation selectors).

## [0.20.1-alpha] - 2026-04-17

> Note: v0.20.0-alpha was tagged but its CI build failed due to a missing `ws` dependency. v0.20.1-alpha is the first shipped binary in the 0.20 line and includes everything originally planned for 0.20.0 plus the dependency fix.

### Added

- Mini-app human-in-the-loop tool calls — declare `renderer.intercept` to gate a tool behind a user-confirmation iframe
- Mini-app custom result rendering via `renderer.result` (manifest `popovers` renamed to `templates`, now shared across popovers / intercepts / result views)
- Mini-app permission prompt shows app icon and name instead of the raw MCP tool string
- Subagent icon pulses while its task is running
- Remote relay status indicator in the sidebar
- Opt-in PostHog usage analytics in settings
- Error state in chat for failed tool results
- Active provider hint in chat suggestions

### Fixed

- Paste chip ring clipped when the chip is selected
- Missing `ws` dependency caused v0.20.0-alpha CI to fail on all platforms; relay WebSocket import now resolves under frozen lockfile

### Refactored

- Centralized IPC string-literal channels and shared device config
- Replaced project row dropdown with a context menu

## [0.19.1-alpha] - 2026-04-15

### Added

- Context injection API for mini-apps
- Enabled toggle for automation edit dialog
- `get_session_state` command for mobile session sync

### Fixed

- Foreground bash showing in background bash panel
- Plan exit accept-edits toggle misaligned with suggestion style
- Event leak to mobile when no session filter is set

## [0.19.0-alpha] - 2026-04-15

### Added

- Scheduled task automation for agents (cron-based triggers)

### Fixed

- Delete-session dialog overflow with long session ids
- Activity panel width not clamped synchronously when shown
- New sessions ignoring user preference permissionMode

## [0.18.7-alpha] - 2026-04-14

### Added

- Template-based popover API for mini-app overlay rendering

### Fixed

- Chat horizontal overflow when activity panel is open
- Duplicated interrupted indicator in chat message footer
- Gap between user bubble and first agent reply block
- Mini-app packaging now non-destructive with cleaner dev appId

## [0.18.6-alpha] - 2026-04-13

### Added

- Terminal reason display (max turns, aborted, blocked) in chat message footer
- 8 new mini-app git bridge APIs: blame, diffSummary, getCommit, tags, remotes, branchDetail, stashList, logFile
- Built-in MCP tools exposed over HTTP for Codex integration

### Fixed

- Permission mode leaking across sessions on switch

### Changed

- Bump claude-agent-sdk to 0.2.101 and MCP SDK to 1.29.0
- Enforce requirement confirmation workflow before mini-app development

## [0.18.5-alpha] - 2026-04-13

### Added

- Cmd+/- content zoom shortcuts for chat and file preview

### Fixed

- Syntax highlighting losing context across chunk boundaries in file preview
- Content clipping on resize by replacing CSS zoom with transform scale
- Code block highlighting in markdown files with YAML front matter

## [0.18.4-alpha] - 2026-04-12

### Added

- Markdown editing with syntax highlighting and auto-save in file preview

### Fixed

- Isolate permissionMode across sessions and scroll after plan approval
- Hold queued messages until step boundary for cancellability

### Performance

- Chunked syntax highlighting and minimap rendering for large files

## [0.18.3-alpha] - 2026-04-11

### Added

- ⌘, keyboard shortcut to toggle settings
- API version and `update_superone_types` MCP tool for mini-apps
- Enhanced standard app tool call display and grouping

### Fixed

- Use SDK replay UUIDs for file checkpoints and simplify rewind flow
- Persist `preapproved.json` for React template dev apps

### Other

- Add BSL 1.1 license

## [0.18.2-alpha] - 2026-04-10

### Added

- Overlay UI APIs for mini-apps (toast, tooltip, context menu)
- System bridge APIs and refactored message handling for mini-apps
- Filesystem protocol, tool lifecycle rebuild, slug-based appId, DnD polish
- Show claude.ai MCP servers in settings with toggle support
- Recipes guide, examples, and binary fs support for mini-app docs

### Fixed

- Always show app drawer even when no apps installed
- Persist rate limit dismiss across session switches
- Horizontal overflow on panel resize
- Support absolute paths for media file preview
- Guard `/review` and `/plan` popup to codex provider only
- Sync guides and React template types with actual API
- Exclude `preapproved.json` and `install.json` from packed `.s1app`

### Refactored

- Extract shared API runtime for bridge and preload

## [0.18.1-alpha] - 2026-04-09

### Added

- Tool preapproval, `.superone` protection, and apps settings
- Simplified scaffold tool, split guides by type, enhanced tool display

### Fixed

- Merge mac build jobs to fix auto-update architecture mismatch

### Performance

- Optimize file preview rendering and reduce panel expand jank

## [0.18.0-alpha] - 2026-04-08

### Added

- Overhauled canvas layout, install target, and UI polish
- Enhanced scaffold with mode/template support and UI improvements
- Permission model with access control, reasons, and install dialog
- Theme, `fs.watch`, and git bridge APIs for mini-apps

### Fixed

- Prevent idle browsed sessions from leaking into session list
- Reset detailed usage when model changes
- Notify frontend immediately when queued message is consumed
- Prevent draft text leaking across sessions
- Serialize hardBreak nodes as newlines in user messages
- Align useChatScroll tests with ResizeObserver-based settle timer

## [0.17.0-alpha] - 2026-04-06

### Added

- Mini-app platform with packaging, installation, and built-in MCP server
- Cmd+W shortcut to close active tab when panel is focused
- Persist activity panel layout and default to left side

### Fixed

- Show argument hints for skills in slash command UI
- Panel resize, chat overflow, and minimap responsiveness
- Trigger clampPanels on sidebar toggle
- Diff background width calculation for correct font size
- Activity panel absorbs window resize, disable single-group drag
- Chat overflow when left activity panel opens

## [0.16.2-alpha] - 2026-04-04

### Fixed

- Panel resize, chat overflow, and minimap responsiveness

## [0.16.1-alpha] - 2026-04-04

### Added

- Long-press ESC interrupt with animated stop button
- Dockview-based ActivityPanel replacing FilePanel
- Dev app scaffold and auto-detection workflow for mini-apps

### Fixed

- Use SDK cumulative cost directly instead of additive accumulation
- Decode URL-encoded file paths in markdown FileLink chips
- Render link safety modal via portal to cover full viewport
- Upgrade Electron 40→41 to fix pdfjs-dist compatibility

### Styling

- Refine table styles and add context usage hover feedback

## [0.16.0-alpha] - 2026-04-02

### Added

- Webview dev mode with DevTools and reload for canvas
- Mini-app system with MCP proxy for canvas
- Dev examples and miniapp-builder skill
- Paste chip for large text pastes

### Fixed

- Cross-session event routing race condition

### CI

- Simplify mac build, add workflow_dispatch with platform selector

## [0.15.0-alpha] - 2026-04-01

### Added

- Upgrade SDK to 0.2.89 with api_retry indicator, slash command & context UI improvements
- Provider-aware context window in ContextUsage

### Fixed

- Consolidate asarUnpack patterns to fix macOS universal build

## [0.14.3-alpha] - 2026-04-01

### Added

- Unique draft session IDs to isolate concurrent drafts
- Copy Working Directory and Open Folder to session context menu
- Isolate dev userData into project-local `.dev-data` directory

### Fixed

- Stop forwarding background session permissions to active session
- PDF preview resize race condition and Codex chat overflow

### Tests

- 220+ unit tests across settings store, MCP library, bash output watcher, and chat store

## [0.14.2-alpha] - 2026-03-31

### Added

- `/plan` slash command for Codex with plan approval flow (approve/reject)

### Fixed

- Codex session title and running indicator for mobile

## [0.14.1-alpha] - 2026-03-31

### Added

- Pixel-accurate DiffView content width using pretext

### Fixed

- Prioritize tool result over live state in ExitPlanMode block
- Stop metadata events from fragmenting streamed text chunks
- Resolve ghost interrupted messages and queued message support for remote sessions
- Clamp sidebar first when FilePanel opens to prevent chat overflow
- Resolve context window from selected model name instead of stale state

## [0.14.0-alpha] - 2026-03-29

### Added

- Replace prefireMessage with SDK priority queue and precise queued turn detection
- Restore @mention directory drill-down with scoped fuzzy search
- Collapsible permission prompt with space toggle

### Fixed

- Convert Codex items to content blocks for mobile history
- Pass mobile permission mode as initialize override

### Performance

- Throttle drag/resize with rAF and optimize DiffView virtualizer

### Tests

- ClaudeAgent init unit tests

## [0.13.1-alpha] - 2026-03-29

### Fixed

- Use cached models for mobile and stabilize fetchModels

## [0.13.0-alpha] - 2026-03-29

### Added

- Support Codex session resume and show codex sessions in list

## [0.12.4-alpha] - 2026-03-28

### Fixed

- Fetch models on first install when no projects exist

## [0.12.3-alpha] - 2026-03-27

### Added

- Enhanced background subagent visibility and interaction routing

### Fixed

- Create proper remote session when mobile resumes old session
- Preserve renamed session title on subsequent task runs
- Chunk large WebSocket responses to avoid Cloudflare 1MB limit

## [0.12.2-alpha] - 2026-03-25

### Added

- Show bash description inline in tool header and permission prompt
- Support video and audio media in markdown rendering

### Fixed

- Remove redundant applyPreferences on session rebuild
- Repair broken tests and add preference coverage

## [0.12.1-alpha] - 2026-03-25

### Added

- Image preview in markdown via media server

### Fixed

- Subagent elapsed time formatting
- Prevent slash menu from reopening on programmatic text set

## [0.12.0-alpha] - 2026-03-25

### Added

- Local media server for video/audio playback in chat and FilePanel
- Phone icon for remote session in project sidebar
- `set_permission_mode` command and selectedSuggestions support for remote
- Broadcast `interaction_resolved` when mobile resolves permissions
- Copy session ID context menu item

### Fixed

- Hide phantom "New session" for unhydrated background sessions
- Rename userSettings permission label to "all projects"
- Test connection spawning CLI without PATH
- Mermaid blocks not auto-converting to preview after streaming ends
- Preserve paragraph breaks between text segments in convert-trace
- Skip truncation for Agent tool_result summary
- Extract insight blocks from text for mobile rendering

### Refactored

- Replace batch timer with promise queue for event sending
- Denormalize session timestamps, extract ProjectSidebarRow
- Extract session runtimes and persist codex turns
- Extract splitTextIntoBlocks and enrich permission in convert-trace

## [0.11.5-alpha] - 2026-03-18

### Added

- Preferences page with project-level output style
- Reasoning summary for Codex, command group expansion and item streaming

### Fixed

- Nested code fences, insight blocks, scroll tracking, and permission overflow
- Checkpoint handling, rewind logging, and test mocks

## [0.11.4-alpha] - 2026-03-17

### Added

- Iframe gate, CDN allowlist, scroll fixes, and guideline updates for widgets

### Fixed

- Canvas placeholder, header layout, and sendPrompt behavior
- Prevent tiny trackpad scrolls from disabling auto-scroll during streaming

### Refactored

- Move theme toggle from sidebar to header titlebar
- Remove click-to-copy on user messages and text segments

## [0.11.3-alpha] - 2026-03-17

### Added

- Updated generative UI guidelines and improved widget rendering

### Fixed

- Disable single-dollar LaTeX to prevent currency symbol misparse
- Guard webContents.send against destroyed window

## [0.11.2-alpha] - 2026-03-17

### Added

- Download button, auto-resize iframe, and improved tool descriptions for widgets

### Fixed

- Use messageStreaming prop instead of session status for completion detection
- Create new widget MCP server per session to prevent connection failure
- Refocus editor after model/effort selector closes

## [0.11.1-alpha] - 2026-03-17

### Fixed

- Use Electron Helper to prevent child process dock icons on macOS

## [0.11.0-alpha] - 2026-03-17

### Added

- Generative UI with streaming preview (widget system)
- Mermaid diagram viewer with fullscreen, zoom/pan, and minimap
- Smart SVG sizing with fit-then-overflow strategy
- Improved copy behavior and mermaid preview
- LaTeX math rendering support via Streamdown math plugin

### Fixed

- Inherit process.env in session query env
- Use Electron as Node runtime in packaged builds

### Performance

- Lazy load messages and reduce re-renders

## [0.10.3-alpha] - 2026-03-15

### Added

- Auto-focus input when creating or switching sessions
- Improved sidebar styling, file tree drop zone, and image preview with zoom

### Fixed

- Auto-expand input area to fit placeholder text on narrow widths

### Refactored

- Unify tool group style and add inline file chip for Codex

### Tests

- 220 unit tests for 12 core modules (crypto, diff-utils, plugins, tool-block-utils, chat-input-utils, stall-utils, MessageBridge, session-history, mcp-config, discover-resources, claude-permissions, and more)

## [0.10.2-alpha] - 2026-03-15

### Fixed

- Handle missing folders gracefully on startup
- Use raw SDK description instead of splitting at separator
- Derive model display names from SDK data instead of hardcoding

## [0.10.1-alpha] - 2026-03-14

### Fixed

- Resolve SDK cli.js by package dir instead of exports map

## [0.10.0-alpha] - 2026-03-14

### Added

- Model display name mapping and MAX effort easter egg
- Align ask-question types with SDK and add preview/notes support
- LaTeX math rendering support
- Input placeholder with provider name and usage hints
- SET_FAST_MODE IPC handler

### Fixed

- Timestamp-based scroll intent to fix trackpad auto-scroll race condition
- Encode local-file URLs to prevent unwanted decoding of percent characters
- Show subagent summary after task completion
- Improve SDK event handling for replay and subagent

## [0.9.0-alpha] - 2026-03-14

### Added

- Live bash output streaming, rate limit indicator, and git status refactor
- Edit/Write diff preview in permission prompt
- ULTRATHINK easter egg for high thinking effort
- Link safety modal for external URLs
- Cmd+N shortcut to create new session

### Fixed

- Eliminate startup flash and improve loading transitions
- Suppress overlay for /compact slash command output
- Convert streaming status to interrupted on session save
- Move sidebar toggle to main header on Windows
- Auto-hide scrollbars, only show while scrolling

### Performance

- Reduce store subscription overhead for typing and streaming

## [0.8.5-alpha] - 2026-03-14

### Fixed

- `local-file://` protocol URL for Windows drive letter paths

## [0.8.4-alpha] - 2026-03-14

### Fixed

- Include `cache_creation_input_tokens` in usage tracking
- Normalize path separators for Windows compatibility
- Update plan mode placeholder and fix option text truncation

## [0.8.3-alpha] - 2026-03-14

### Fixed

- Use platform separator in path validation and skill install

## [0.8.2-alpha] - 2026-03-14

### Fixed

- Use platform path separator in `isPathWithinAllowed` (security)

## [0.8.1-alpha] - 2026-03-13

### Added

- ReviewPanel for interactive code review and git log IPC
- Overhaul minimap scroll, optimize DiffView, fix external file preview

### Fixed

- Session isolation, restore, and reset for Codex sessions
- Remove unnecessary keyDown handler from ReviewPanel search input
- Allow hidden files in mention search, hide completed codex todos

### Refactored

- Expand EXCLUDED_DIRS with common build/cache directories

## [0.8.0-alpha] - 2026-03-13

### Added

- Codex integration: isolated sessions, worktree cwd support
- Plan item UI and collaboration mode
- Route tool/requestUserInput through ask_user_question flow
- Cancel decision in permission flow, upgrade codex-sdk to 0.114.0

### Refactored

- Extract TodoListPanel and unify codex todo display

### Tests

- Codex experiment service unit tests

## [0.7.4-alpha] - 2026-03-12

### Fixed

- Accumulate subagent input tokens instead of overwriting
- Defer session eviction until DB save completes

### Refactored

- Move cwd to per-session state and unify resume logic

## [0.7.3-alpha] - 2026-03-11

### Added

- Improved sandbox permission request UI

### Fixed

- Scrollable project list in ProjectSelector dropdown
- Isolate worktree path per session and detect removed worktrees
- Handle raw bash input parsing and preserve background task completed state
- Prevent programmatic scroll from disabling auto-scroll
- Make entire reasoning block header clickable for expand/collapse
- Clear pending worktree state when switching to local session

## [0.7.2-alpha] - 2026-03-11

### Added

- Move support for external drops and improved drag-drop UX in file tree
- rootPath support for multi-root workspaces in search

### Fixed

- Use inset ring for drag-over highlight to prevent clipping

### Tests

- Permission queue and deduplication tests

## [0.7.1-alpha] - 2026-03-11

### Fixed

- Use inset ring for drag-over highlight to prevent clipping

## [0.7.0-alpha] - 2026-03-11

### Added

- File operations with drag-and-drop support in file tree
- Fuzzy file search IPC for @mention popup
- Fuzzy search for slash commands

## [0.6.1-alpha] - 2026-03-10

### Fixed

- Queue concurrent permission requests instead of overwriting

## [0.6.0-alpha] - 2026-03-10

### Added

- Clickable FileChip in read tool and markdown file links for Codex
- Granular usage tracking, steer routing, and model caching for Codex
- Upgrade Codex SDK to 0.112.0 with commandActions parsing

### Fixed

- Prevent layout shifts from breaking auto-scroll during streaming
- Accumulate input tokens across multi-step turns

### Refactored

- Extract CopyableMarkdown and ReasoningBlock components

## [0.5.4-alpha] - 2026-03-09

### Fixed

- Pass SDK CLI path in CONNECT_CLAUDE query for Windows

## [0.5.3-alpha] - 2026-03-09

### Added

- Remote control settings page, store, and sonner toast
- Secure two-phase pairing with paired devices persistence
- Per-agent config and multi-agent activation support

### Fixed

- Skip session rename on Enter during IME composition
- Wrong OpenRouter icon for DMXAPI/PackyCode and remove redundant badge

### Refactored

- Remove typewriter animation from CodexTurnView

## [0.5.2-alpha] - 2026-03-05

### Fixed

- Pass SDK CLI path to query() for packaged app asar support

## [0.5.1-alpha] - 2026-03-05

### Fixed

- Use SDK bundled CLI instead of system Claude Code

## [0.5.0-alpha] - 2026-03-05

### Added

- Provider management with model mapping and preset configs

### Fixed

- Upgrade codex-sdk to 0.107.0 and fix IME/scroll issues

### Tests

- Provider env mapping, env injection, and maskApiKey tests

## [0.4.2-alpha] - 2026-03-04

### Fixed

- Tool block overflow and denied feedback layout
- Text overflow in user message bubbles

### Refactored

- Consolidate markdown rendering into MarkdownView component

## [0.4.1-alpha] - 2026-03-03

### Fixed

- Defer GH_TOKEN cleanup to avoid updater race condition

## [0.4.0-alpha] - 2026-03-03

### Added

- Inline activity panels, background task collapse, and async agent output
- Rebuild session when switching to/from bypassPermissions mode

### Fixed

- Validate HEAD before branch creation and case-insensitive branch name matching

## [0.3.2-alpha] - 2026-03-02

### Added

- Dismissible rate limit indicator with absolute reset time
- Deferred session resume with awaitingAssistantReply state
- Link safety modal for external URLs
- Click file chip to open file in panel
- Batch session cleanup by time period

### Fixed

- Error handling and startup diagnostics
- Cross-platform Codex runtime detection with system CLI fallback
- Guard disposed bridge and handle pre-ID session parking
- Long text overflow in user messages
- Scope GH_TOKEN to update check duration
- Respect upward scroll during streaming
- Use latest step input tokens instead of accumulating
- Prevent worktree state from polluting non-worktree sessions

## [0.3.0-alpha] - 2026-03-01

### Added

- Path-security module and hardened IPC handlers
- Improved subagent rendering, session history, and store event handling
- Session hide, paginated listing, and improved error logging
- Event trace infrastructure for debugging data flow
- Session context menu with hover icons replacing dropdown
- Prompt prefire to queue messages during streaming

### Fixed

- Sync turnMessageId for slash commands without assistant messages
- Route new-turn content to correct messageId during background tasks
- Auto-scroll input to cursor on new line insertion

## [0.2.2-alpha] - 2026-02-28

### Fixed

- Use strict NODE_ENV check for raw session logging

## [0.2.1-alpha] - 2026-02-28

### Fixed

- Handle local_command_output system messages and add raw session logging
- Preserve leading whitespace in git status output
- Improve denied tool border, minimap diff contrast, and file preview markdown

## [0.2.0-alpha] - 2026-02-28

### Added

- Cmd+N shortcut to create new session
- Live bash output streaming, rate limit indicator, and git status refactor
- Dedicated Kbd component replacing CommandShortcut

### Fixed

- Worktree indicator incorrectly shown on normal sessions
- Expand bash tool block during execution and improve tool UI
- Auto-clamp panels on window resize and fix diff view min-height
- Show preparing state during blockmap phase and allow dismiss

### Tests

- Unit tests for git-status-utils, ansi parser, and tool-block-utils

## [0.1.0-alpha.4] - 2026-02-27

### Added

- PDF zoom controls, URL source support, and responsive scaling
- File preview support for images, PDF, SVG, video, and audio

## [0.1.0-alpha.3] - 2026-02-27

Initial tagged release.

## [0.1.0-alpha.2] - 2026-02-27

### Fixed

- Theme-aware syntax highlighting in diff view
- Light mode support for subagent type badge
- Rename explorer to files and fix file tree race condition

### Refactored

- Use applyDefaultModel helper for session model init

## [0.1.0-alpha.1] - 2026-02-27

Initial alpha release of SuperOne.
