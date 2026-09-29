# Terminal agent tools (`terminal_*`)

SuperOne exposes interactive local PTY tabs through four host tools. Remote-node
agent sessions receive an explicit unsupported result. The remote node's raw
terminal RPC is a separate surface and does not imply agent-tool support.

## 1. Product layering

Commands that finish without further input use the harness shell tool, including
long builds and test suites. Dev servers, watch modes, REPLs, TUIs, SSH and
interactive wizards use a foreground command in a terminal tab. The tab lets the
user see output and type alongside the agent; it survives the tool call and turn.

The agent reads the headless xterm's rendered screen, not raw ANSI output. Ending
a turn cancels pending waits without killing a server. Close agent-opened tabs
when their work ends; keep a server the user asked to leave running.

## 2. Contract ownership

`packages/shared/src/environment/host-action-terminal-descriptors.ts` owns the
schemas. Desktop registrations derive from them, and descriptions live in
`packages/shared/src/superone-tool-descriptions.ts`. Chat names are
`mcp__superone__terminal_<verb>`.

## 3. Runtime components

| Responsibility | Desktop source |
|---|---|
| PTY and rendered screen | `main/terminal/pty.ts`, `terminal-session.ts` |
| Per-command control | `main/terminal/terminal-control.ts` |
| Conditions and keys | `main/terminal/terminal-wait.ts`, `terminal-keys.ts` |
| Tool handlers | `main/mcp/terminal-tools.ts` |
| Permission gate | `main/mcp/terminal-command-gate.ts`, `terminal-tabs-harness-gate.ts` |
| Confirmation and session rules | `main/mcp/terminal-command-confirm.ts`, `terminal-session-rules.ts` |
| Project rules | `main/db-terminal-command-rules.ts`; shared `terminal-command-rules.ts` |

`TerminalManager` owns the tabs; `terminal_created`, `terminal_exited` and
`terminal_control_changed` synchronize the visible UI.

## 4. Tool surface

| Tool | Contract |
|---|---|
| `terminal_tabs` | `list`, `run`, `attach`, `close`; `run` accepts command, optional rule, cwd, title, size and yieldMs. Reuses an idle tab when supplied. |
| `terminal_snapshot` | Read screen, scrollback, cursor or metadata. Default screen; scrollback tail defaults to 200 and caps at 2000 lines. |
| `terminal_act` | One action or a fail-fast sequence of at most 20: type, key, raw, resize, wait. Can wait for an `expect` after the batch. |
| `terminal_wait_for` | AND-combined text, textGone, idleMs and exited conditions. Returns the screen and whether the conditions were met. |

`run` types into a login shell so the tab remains usable when the command ends.
Its initial size defaults to 120×40, `yieldMs` to 5000 (maximum 30000). It cannot
replace a command already running in a reused tab. `attach` approves the running
command in an existing user tab; there is no grant for a blank shell.

`type` adds Enter unless `enter:false`; named keys support terminal escape
sequences and repeated presses. A batch `wait` is at most 5000ms. Act's condition
timeout defaults to 15000ms and caps at 60000ms; wait-for caps at 120000ms.
`promptReady` is not a schema field: OSC 133 prompt integration is not implemented.
Oversized scrollback spills to a file instead of enlarging the inline result.

## 5. Permissions

Harness admission and command authorization are distinct. Snapshot, act and wait
are statically host-owned; they drive a command already approved. `terminal_tabs`
is excluded from static auto-allow so a harness can review a new command.

`HARNESS_CAPABILITIES[harness].terminalCommandApproval` selects where the common
gate runs: at the harness permission callback for Claude, Codex, ACP, OpenCode
and DeepSeek, or in the executor for Cursor custom tools. A harness that clears
a command itself need not trigger a second dialog. When the host gate is called,
it checks remembered rules before asking through a `terminal_command_confirm`
permission request.

The approval subject is the command, cwd and tab, not unrestricted access to a
terminal. Choices are once, matching commands for this session, or matching
commands in this project. Rules are JavaScript regexes matched against the whole
normalized command. A supplied rule must be valid and match; otherwise the gate
derives one, keeping compound/quoted/delegated commands narrow. Session rules
are in memory; project rules live in SuperOne's database, across harnesses.
They are editable in terminal settings and never written to Claude settings.

Control lasts while the approved command is running. When it exits, act is
rejected with `command_exited`; another command requires another `run`. A user
can type concurrently. `takeOver()` explicitly revokes control for callers that
need it, but there is no takeover button in the current terminal UI.

Agent-opened tabs are scoped to their owning session. Reading a user tab requires
attach first. Closing an agent-opened tab needs no additional confirmation;
closing a user tab asks once without an always-allow option. Decline, cancel and
timeout produce neutral rejected/cancelled results and are not invitations to
retry the request.

## 6. Command lifetime and waits

`TerminalControl` observes the PTY foreground process every 200ms. It records a
command leaving the shell and releases the grant when the shell returns. A
startup grace period plus output quietness handles commands too short to observe
between polls. `TerminalSession` also revokes control when the PTY exits.

Idle is lack of output, not proof of successful completion. A ready banner is
usually the useful condition for a server; foreground return is the command
boundary. OSC 133 markers and a Windows-specific foreground fallback are not
implemented, so the documentation must not promise prompt-ready or reliable
Windows command-boundary detection. A shell's continued life is not the exit
status of the command typed into it.

## 7. UI and ownership

Desktop `TerminalToolBlock.tsx` summarizes the operation and returned screen;
clicking a tab reference reveals the activity tab. `agentSessionId` keeps agent
tabs in the owning session's activity panel instead of the bottom project panel.
`materializeOwnedTerminalTabs` restores those tabs when the session opens.
The activity tab shows the controlling command while the grant is active.

Mobile chat has a terminal presenter in `packages/chat-view/src/presenters/`;
it does not fall back solely to generic MCP text. Terminal results are preserved
by the mobile event projection so their structured screen data remains usable.

## 8. Verification and limitations

Colocated tests cover descriptor/admission consistency, command rules, rejected
confirmations, control release, key encoding, waits and handler behavior.
Desktop terminal ToolBlock stories cover the visual states; the portable
presenter has its own tests. These are the affected checks for contract changes.

Remote-node agent execution, prompt markers, per-tab recordings and process
resource metrics are outside the current tool contract. Add them only with their
runtime behavior, permission boundary and presentation covered together.
