# Terminal agent tools (`terminal_*`)

Status: **v1 implemented (desktop, local terminals)** — designed 2026-09-15 after
surveying Codex `exec_command` / `write_stdin` / `thread/backgroundTerminals/*`
and SuperOne's existing terminal stack; built 2026-09-16. Not yet: remote-node
sessions (the executor returns an explicit unsupported error), OSC 133 prompt
markers (§6 item 3), Windows foreground detection.

## 1. Product layering

Two tool families, two jobs. The split is by **process lifetime and interactivity**,
not by "how long the command takes":

| | Harness shell tool (Claude `Bash`, Codex `shell`, ACP terminal) | `terminal_*` (SuperOne host tools) |
|---|---|---|
| Runs | one command to completion, output captured | a real PTY tab in the project's terminal panel |
| Lifetime | ends with the call | outlives the call and the turn; user decides when it dies |
| Input | none after launch | keystrokes at any time |
| Where | inside the harness sandbox / permission model | Electron main (or remote node), **outside** the harness sandbox |
| Use for | build, test, grep, git, scripts | dev servers, watch modes, REPLs, TUIs (vim, htop, lazygit), ssh, interactive wizards (`npm init`, `gh auth login`), anything that prompts |

The mental model is **browser use for terminals**: the agent gets the same tab the
user sees, reads the screen the way it reads a page, sends keys the way it clicks,
and waits for a state the way it waits for a selector. The user can watch, take over
by typing, and hand it back.

This is not a replacement for the harness shell tool. The system prompt keeps
routing one-shot commands there; `terminal_*` descriptions say so explicitly.

## 2. What Codex does (reference)

- `exec_command(cmd, tty, yield_time_ms, max_output_tokens)` runs in a PTY and returns
  `{ output, exit_code }` if the process ends before `yield_time_ms`, otherwise
  `{ output, session_id }`. `write_stdin(session_id, chars, yield_time_ms)` writes and
  returns recent output; empty `chars` is a pure poll. Output is head/tail-truncated to a
  token budget.
- Processes are **thread-scoped**, not turn-scoped. The client lists them via
  `thread/backgroundTerminals/list` (`process_id`, `command`, `cwd`, `os_pid`,
  `cpu_percent`, `rss_kb`) and kills via `.../terminate`.
- Every stdin write is surfaced to the client as `TerminalInteractionNotification`, so
  the UI can show what the model typed.

What we take: the yield semantics (return early, hand the model a handle), the
thread-scoped lifetime, and "stdin writes are visible to the user". What we skip: a
separate process manager and raw-stream output. SuperOne already owns a headless
xterm per terminal, so the agent reads a **rendered screen**, not an ANSI stream.

## 3. Existing foundation

| Layer | Already there |
|---|---|
| PTY + screen | `TerminalSession` (`apps/desktop/src/main/terminal/terminal-session.ts`): node-pty, `@xterm/headless` + `SerializeAddon`, `input/resize/snapshot/kill`, output frames carry `fromSeq/toSeq`, OSC title → `terminal_title_changed` |
| Registry | `TerminalManager.create/get/list/listForProject/kill`, already injected into `AgentService.setTerminalManager` (used by phone remote control) |
| UI sync | `terminal_created` auto-adds a tab to the project's terminal panel; `terminal_exited` removes it (`useTerminalSync.ts`) |
| Ownership | `TerminalOwnership`: `local` vs `deviceId`, exclusive write, `terminal_owner_changed` → owner chip in `TerminalPanel.tsx` |
| Remote node | CLI RPC `terminal.create/attach/read/write/resize/kill` + `RemoteTerminalController` mirroring events into the same `TerminalEvent` stream |
| Tool shell | `registerSuperoneTools` / `BUILT_IN_SUPERONE_TOOL_DEFS` / host-action descriptors; `HostConfirmRegistry` for unbypassable confirms |

Missing: the agent-facing contract, a per-command control grant, a screen-text reader
on the headless xterm, foreground/idle/prompt detection, and the chat ToolBlock.

## 4. Tool surface

Four tools, mirroring the compact browser surface (`browser_tabs / snapshot / act /
wait_for`). Names are `terminal_<verb>`; chat wire name `mcp__superone__terminal_<verb>`.

### `terminal_tabs`

Discover and manage terminal tabs for the current project.

```
action: 'list' | 'run' | 'attach' | 'close'       // default list
tab?: string | string[]                            // terminalId(s)
command: string                                    // run: the command to approve and type
cwd?: string                                       // run: default project root
title?: string                                     // run: tab title shown to the user
size?: { cols: number; rows: number }              // run: default 120×40
description?: string                               // shown to the user instead of raw args
```

- `list` → TOON table: `tab, title, cwd, status(running|exited), foreground(command or
  shell), control(none|agent), lastActivityMs, altScreen`.
- `run` asks the user to approve **`command`** (§5), opens a login shell in a real tab
  in the activity panel, types the command, and returns once the command produces
  output, goes idle, or exits (§6). Returns `{ tab, screen, status, exitCode? }`. The
  agent controls the tab **only while that command is the foreground process**.
  `run` on an existing `tab` reuses it when the shell is at a prompt (a second command
  in the same tab), otherwise fails with the running command's name.
- `attach` asks to control the command currently running in a tab the user opened
  (the user started the dev server; the agent wants to read the logs and press `r`).
  Approval subject is that command; control ends when it exits, like `run`.
- `close` kills the PTY and removes the tab. Not undoable; never close a tab the user
  is using or a server the user asked for. Agent-opened tabs: no confirm. User tabs:
  confirm, no always-allow.

There is no way to obtain a blank controlled shell: every grant names a command.
For a REPL, `run` with `command: "python3"` and then `terminal_act` into it.

### `terminal_snapshot`

Read a tab. `include` picks sections, default `[screen]`:

```
tab: string
include?: ('screen' | 'scrollback' | 'cursor' | 'meta')[]
tail?: number             // scrollback: lines from the end, default 200, max 2000; spills to a file past the inline cap
```

- `screen` — the visible rows×cols grid as plain text, trailing whitespace trimmed.
  This is what matters for TUIs and prompts.
- `scrollback` — the last `tail` lines of scrollback + viewport as plain text
  (rendered through the headless xterm, so no escape codes). This is what matters
  for servers and logs. Oversized output is spilled like `browser_evaluate`. (An
  incremental `sinceSeq` cursor was dropped: xterm's ring buffer has no stable line
  ids; `terminal_wait_for text` covers the "has X appeared" case.)
- `cursor` — `{ row, col, visible }`; `meta` — title, cwd, status, foreground command,
  control, exit code, `altScreen` (true while a full-screen program owns the terminal), size.

### `terminal_act`

Send input. One action per call by default; batch 2–20 for an uninterruptible
sequence (answer a wizard's three prompts). Fail-fast.

```
tab: string
actions: Action[]
expect?: { text?: string; textGone?: string; idleMs?: number; exited?: boolean; promptReady?: boolean }
timeoutMs?: number         // default 15000, max 60000
description?: string
```

`Action` is one of:

| type | fields | notes |
|---|---|---|
| `type` | `text`, `enter?: boolean` (default true) | text is written verbatim; `enter:false` for partial input |
| `key` | `key: 'Enter' \| 'Tab' \| 'Escape' \| 'Backspace' \| 'Up' \| 'Down' \| 'Left' \| 'Right' \| 'Home' \| 'End' \| 'PageUp' \| 'PageDown' \| 'Ctrl+C' \| 'Ctrl+D' \| 'Ctrl+Z' \| 'Ctrl+L' \| 'Ctrl+<letter>' \| 'F1'…'F12'`, `repeat?` | mapped to the correct escape sequence for the current mode (cursor-key application mode is tracked by xterm) |
| `raw` | `bytes` (string) | escape hatch for sequences the table lacks |
| `resize` | `cols`, `rows` | mirrored to the UI tab |
| `wait` | `ms` (≤ 5000) | inside a batch only |

Returns `{ ok, stepsExecuted, screen, status, exitCode?, expectMet }` — the screen after
the batch, so most interactions are act → read → act without a separate snapshot.

### `terminal_wait_for`

Block until a tab reaches a state; conditions AND-combine.

```
tab: string
text?: string              // substring visible on screen or in new scrollback
textGone?: string
idleMs?: number            // no output for this long (the terminal "network idle")
exited?: boolean
promptReady?: boolean      // shell integration marker, see §6
timeoutMs?: number         // default 15000, max 120000
```

"Wait for `Local:   http://localhost:6006` or 60s" is one call, not a poll loop.
Returns the screen plus which conditions were met.

### Not in v1

- `terminal_evaluate`-style "run this and give me the output": that is the harness
  shell tool.
- Per-tab recordings (asciinema). Worth adding later; the browser tools set the
  precedent with `recording: true`.
- Interrupt-on-turn-abort for the process: aborting a turn cancels pending waits
  but leaves the process running, same as Codex.

## 5. Permissions

Two independent decisions, per `superone-tool` → contract.md.

**Harness admission.** All four bare names go into the static host-owned set so every
harness reaches the executor without its own prompt. Otherwise Claude auto-mode may
deny `terminal_act` per keystroke and Codex would elicit on every call, which makes
interactive use impossible.

**Executor authorization — per command, like the shell tool.** Handing over "a
terminal" (the way `device_request_control` hands over a device) is too broad: a
terminal can do anything. The unit that is approved is the **command**, and control is
bounded by that command's lifetime:

- `terminal_tabs run` / `attach` raise a host `permission_request`
  (`requestKind: 'terminal_command'`) showing the command, cwd, and tab. The dialog
  offers *Allow once* and *Always allow in this project*; the latter stores a rule
  keyed by project path with the same prefix grammar the harness shell rules use
  (`bun run storybook:*`, `python3`, `ssh staging:*`). Rules are SuperOne-owned
  (SuperOne DB, harness-agnostic), not written into `.claude/settings.json`, and are
  listed/removable in project settings next to mini-app preapprovals.
- **Control = "the approved command is the foreground process of that tab."** While it
  is, `terminal_act` writes go through: stdin to a REPL, keys in a TUI, answers to a
  wizard are all input *to the approved program*. When the command exits and the tab
  returns to the shell prompt, control is released automatically; the next
  `terminal_act` returns `status: 'rejected', reason: 'command_exited'` with the exit
  code and a hint to call `terminal_tabs run` again. Typing a new command into the
  shell is therefore always a new approval — that is the whole point.
- Multi-command strings (`cd x && bun dev`) are one approval and one foreground job,
  same as the shell tool. A command that itself spawns a shell (`ssh`, `docker exec -it`)
  is approved as that command; what happens inside is covered by the rule for it, which
  is why `ssh staging:*` should not be always-allowed lightly. The dialog says so.
- The user can type into a controlled tab at any time (no exclusive lock — this is a
  program they approved, not a device), exactly as they can click a page the browser
  tools are driving. There is deliberately no "take over" button: to stop the agent,
  end the command (Ctrl+C releases control on its own) or tell it in chat.
  `TerminalSession.takeOver()` exists for hosts that want an explicit revoke (the
  next `terminal_act` returns `reason: 'user_took_over'`), but v1 wires no UI to it.
- `terminal_snapshot` and `terminal_wait_for` read without a grant on agent-opened
  tabs; on user tabs they require an `attach` first (log content can be sensitive).
- `terminal_tabs close` on an agent-opened tab does not confirm; a user tab confirms
  with `allowAlwaysAllow: false`.
- Every `terminal_act` batch is visible in chat (§8) and in the tab itself, matching
  Codex's `TerminalInteractionNotification`.

Decline / cancel / timeout return neutral `status: 'rejected' | 'cancelled'` results
with a hint, never `isError`.

## 6. Command lifetime, completion, and idle

The same signal answers two questions: "has the command finished?" (the agent's
completion condition) and "may the agent still type?" (the control boundary in §5).

1. **Foreground process** — node-pty exposes `IPty.process`, the title of the
   foreground process (`tcgetpgrp` on macOS/Linux). After `run` types the command,
   the session polls (200 ms) until the foreground leaves the shell and records that
   job as the controlled command; when the foreground returns to the shell, the
   command exited. Universal for user tabs too (no rc injection needed), which is what
   makes `attach` work. Not available on Windows ConPTY → fall back to 3.
2. **Idle** — no PTY output for `idleMs` (default 400 ms for `run`, caller-chosen for
   `wait_for`). Cheap; the "server printed its banner and went quiet" signal.
3. **Prompt marker** — OSC 133 A/B/C/D shell integration, injected only into
   agent-opened tabs (env var + rc snippet, the VS Code technique; bash
   `PROMPT_COMMAND`, zsh `precmd`/`preexec`, fish native, PowerShell prompt function).
   Gives the exit code (`133;D;<code>`) and a crisp prompt-ready edge. `promptReady`
   falls back to 1 + 2 with `promptReadyFallback: true` when the marker is absent.

`run` types the command into a login shell rather than spawning `shell -lc cmd` so the
tab stays a usable shell for the user after the command exits, and so Ctrl+C on a dev
server returns to a prompt instead of an exited tab.

## 7. Backend plan

Files, in build order:

1. `packages/shared/src/superone-tool-descriptions.ts` — four descriptions
   (≤ 700 chars, with the "one-shot commands: use your shell tool" exclusion).
2. `packages/shared/src/superone-host-owned-tools.ts` — add the bare names.
3. `packages/shared/src/agent-types.ts` — `TerminalListItem` gains `foreground` and
   `control: { sessionId; command } | null`; new `terminal_control_changed` event;
   `requestKind: 'terminal_command'`.
4. `apps/desktop/src/main/terminal/terminal-session.ts` — `screenText()`,
   `scrollbackText(sinceSeq)`, `cursor()`, `altScreen` (from `term.buffer.active.type`),
   `waitFor(cond, signal)`, foreground tracking (`pty.process` poll + OSC 133),
   key-name → sequence mapping (`terminal-keys.ts`).
5. `apps/desktop/src/main/terminal/terminal-control.ts` — per-tab
   `{ sessionId, command, startedAt }` grant, released on foreground return / take-over.
6. `apps/desktop/src/main/terminal/terminal-command-rules.ts` — project-scoped
   always-allow rules (prefix grammar shared with the shell-tool rule matcher), plus
   `apps/desktop/src/main/mcp/terminal-tools.ts` — the four handlers; confirm via
   `HostConfirmRegistry` (`terminal-command-confirm.ts`), resolved in
   `Session.respondToPermission`.
7. `superone-mcp-builtin-defs.ts` / `superone-mcp-builtins.ts` — descriptor + zod
   registration + execute switch. `BuiltInSuperoneToolDeps` gains `terminals`.
8. `packages/shared/src/environment/host-action-terminal-descriptors.ts` — remote
   parity. The CLI `terminal.*` RPC lacks a rendered screen (it keeps a raw ANSI
   snapshot); either add `@xterm/headless` to `apps/cli/src/terminal/manager.ts` or
   render on the desktop side inside `RemoteTerminalController`. Desktop-side keeps
   the CLI thin; decide during implementation.
9. System prompt (`superone-system-prompt.ts`): one paragraph on the layering and on
   leaving servers running / closing tabs you opened, parallel to the browser rule.

Tests first for: admission-set membership, confirm decline/cancel/abort no-ops, rule
matching (prefix, project scope), control release when the foreground returns to the
shell, rejection after take-over, key mapping, idle and OSC 133 detection with a fake
PTY, scrollback spill.

## 8. Chat and terminal-panel UI

- **ToolBlock** `TerminalToolBlock.tsx`: one row per call — icon, tab title,
  `description` or a summary (`typed "bun run storybook" · waited for "Local:"`), the
  post-action screen collapsed to the last 8 lines with expand. Clicking the title
  reveals the tab in the terminal panel. Stories: open (pending confirm / granted /
  rejected), act batch, wait_for met / timed out, exited tab, long screen, narrow.
- **Activity panel**: `run` opens the tab in the activity panel of the session that
  ran it. `TerminalListItem.agentSessionId` records the owner: the bottom terminal
  panel (per project) leaves such tabs out, `terminal_created` docks the tab only
  when its owner is the on-screen session, and `materializeOwnedTerminalTabs` adds
  the rest when the owner session is restored — the same model as agent browser
  tabs. Other sessions' tools do not list or resolve the tab.
  While the agent controls the command the tab shows a Bot icon and a status line
  *Agent is driving `bun run storybook` — you can type here too*; it clears itself when
  the command exits. Reuse the remote-device banner styling.
- **Mobile**: tool row falls back to the generic MCP presenter until the mobile
  terminal presenter learns the new event shape; `reference_mobile_event_strip_footgun`
  applies — exempt `terminal_*` from event stripping.

## 9. Open questions

1. Rule grammar — reuse the harness shell-rule prefix syntax verbatim (`cmd:*`) so
   users have one mental model, or a simpler "exact command / any args" pair? Proposed:
   reuse the prefix syntax.
2. Windows: no `tcgetpgrp`; control boundary relies on OSC 133 in agent-opened tabs and
   `attach` is unavailable on user tabs. Acceptable for v1?
3. Whether to expose `os_pid` / CPU / RSS in `list` like Codex. Cheap on local, not
   available from the CLI RPC today. Proposed: local-only, `undefined` on remote.
