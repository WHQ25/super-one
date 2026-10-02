# OpenCode behavioral contracts

Upstream behavior SuperOne depends on that the published types do not state.

## Native agent and permission ownership

- **Behavior:** agent selection and permission rules are separate. Leaving an
  agent unspecified preserves the native session/default selection; selecting
  `plan` is an agent switch, not a wildcard permission override.
- **Observed:** OpenCode V2 agents/permissions documentation and 2.0.22 API.
- **Depends on it:** `apps/desktop/src/main/opencode/opencode-v2-runtime.ts`.
- **Guard:** `opencode-v2-runtime.test.ts`, `opencode-runtime.test.ts`, and
  `apps/desktop/src/renderer/src/components/chat/OpenCodeAgentSelector.test.tsx`.
- **Compatibility:** older SuperOne sessions used a leading wildcard rule and
  only exact host allows plus optional edit/question exceptions. The adapter
  recognizes that legacy shape and replaces it with host admission only. Other
  native session rules are preserved; global/project/agent configuration is
  never rewritten.

## 2.x serve always requires basic auth

- **Behavior:** `opencode serve` 2.x rejects `/api/*` without basic auth (user
  `opencode`) and prints a random password when `OPENCODE_SERVER_PASSWORD` is unset.
  1.x enables the same auth from the same variable. The ready line changed from
  `opencode server listening on <url>` to `server listening on <url>`, so a spawned
  server's version is read from its ready line.
- **Observed:** 2.0.22, live server.
- **Depends on it:** `apps/desktop/src/main/opencode/opencode-client.ts#startOpenCodeServer`
- **Guard:** `apps/desktop/src/main/opencode/opencode-server-protocol.test.ts`

## 2.x protocol detection through `/api/info`

- **Behavior:** 2.x answers `GET /api/info` with JSON `{ version }`; 1.x has no such route.
  A wrong or missing password gets `401` (2.x: JSON `UnauthorizedError`). Used for
  attached `serverUrl` servers only.
- **Observed:** 2.0.22, live server.
- **Depends on it:** `apps/desktop/src/main/opencode/opencode-client.ts#detectOpenCodeProtocol`
- **Guard:** `apps/desktop/src/main/opencode/opencode-server-protocol.test.ts`

## 2.x catalogs load per location on first use

- **Behavior:** the first `GET /api/agent|command|model?location[directory]=…` for a
  directory answers an empty list; a later request returns the catalog. Models are
  also empty until providers settle after start.
- **Observed:** 2.0.22, live server.
- **Depends on it:** `apps/desktop/src/main/opencode/opencode-v2-client.ts#settledList`
- **Guard:** `apps/desktop/src/main/opencode/opencode-v2-client.test.ts`

## 2.x execution events also fire outside prompts

- **Behavior:** `session.execution.*` events carry no execution id and also wrap
  non-prompt work such as clearing a revert, so a `succeeded` can arrive right before
  the next prompt's own execution. Prompts, commands and manual compaction are inbox
  items: `session.inbox.enqueued` → `execution.started` → `session.inbox.delivered`
  (same `inboxID`) → … → terminal execution event; only that execution settles the
  turn. Interrupted turns emit `session.step.failed` (`aborted`) and
  `session.execution.interrupted`, and their `*.ended` events (and an interrupted
  shell's `session.shell.ended`) can arrive after the next prompt was sent. `!command`
  shells emit only `session.shell.started/ended`.
- **Observed:** 2.0.22, live event streams.
- **Depends on it:** `apps/desktop/src/main/opencode/opencode-v2-event-map.ts#OpenCodeV2TurnTranslator`
- **Guard:** `apps/desktop/src/main/opencode/opencode-v2-event-map.test.ts`

## 2.x MCP code mode hides tool calls

- **Behavior:** by default 2.x exposes MCP tools to the model through one `execute` tool
  whose input is a script; the permission ask for the MCP tool carries no arguments.
  With `codemode: false` the tool is called directly as `<server>_<tool>` and
  `session.tool.called` carries its input under the permission's `source.id`.
- **Observed:** 2.0.22, live MCP stdio server.
- **Depends on it:** `apps/desktop/src/main/opencode/opencode-v2-client.ts#toOpenCodeV2McpConfig`
- **Guard:** `apps/desktop/src/main/session/backends/opencode-backend-v2.test.ts`

## 2.x snapshots need a canonical directory

- **Behavior:** a session whose location is a symlinked path (for example `/var/…` on
  macOS) records no file snapshots: `diff` is empty and revert restores nothing. The
  resolved path works, so SuperOne resolves every 2.x location it sends.
- **Observed:** 2.0.22, live runs in a temporary git repository.
- **Depends on it:** `apps/desktop/src/main/opencode/opencode-v2-client.ts#canonicalDirectory`
- **Guard:** `apps/desktop/src/main/opencode/opencode-v2-client.test.ts`
