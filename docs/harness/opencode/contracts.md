# OpenCode behavioral contracts

Upstream behavior SuperOne depends on that the published types do not state.

## Permission scope is independent of tool arguments

- **Behavior:** V2 `Permission.Request` carries `action`, `resources`, optional
  `save`, `metadata`, `source` and `message`. External-directory resources are
  canonical directory boundaries (normally `/*`); approving them does not bypass
  the subsequent read/edit check. Metadata may be empty. Tool input comes from
  `session.tool.called` under `source.id`, not from permission metadata. A pending
  request replay can have a source but no cached input; do not invent arguments.
- **Observed:** V2 permissions documentation and published OpenAPI, 2026-10-07.
- **Depends on it:** `opencode-v2-event-map.ts#OpenCodeV2TurnTranslator`, shared
  `PermissionRequest.permissionDetails` and `permission-details.ts`, desktop
  `PermissionDetails.tsx` and mobile `PermissionContent.tsx`.
- **Guard:** `opencode-v2-event-map.test.ts`, `PermissionPrompt.integration.test.tsx`,
  shared `permission-details.test.ts` / `node-session-event-map.test.ts`, mobile
  `PromptSheet.test.tsx`. Scope remains distinct from proposed saved patterns,
  and the existing once/always/reject reply behavior is unchanged.
- **GUI presentation:** match the 2.0.24 CLI's action-based title/icon and primary
  path, command or diff. Source identity and raw metadata live in collapsed
  technical details. Only a nonempty `save` plus `allowAlwaysAllow` offers
  project persistence; selecting it previews the exact proposed patterns before
  sending `always`. Cancelling that preview sends no permission reply. Preview
  state is bound to the request id, so it cannot approve the next request.
  Desktop and phone share `permission-presentation.ts`; the desktop keeps
  its existing high-risk keyboard guard. `permission-presentation.test.ts`,
  `PermissionPrompt.test.tsx`, `PermissionPrompt.integration.test.tsx`,
  `opencode-backend-v2.test.ts` and mobile `PromptSheet.test.tsx` guard this flow.
  Storybook: `Tool UI/General/Permission Prompt` (`OpenCode*` stories) and
  `Mobile/Permission Details`.

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
- **Discovery:** desktop IPC and mobile catalog requests share the same lazy
  probe. Cache identity includes the directory; failures cannot substitute a
  different project's agents or commands. A partial models/agents result is not
  a fresh-cache hit, so initial settlement cannot freeze an empty picker for the
  24-hour TTL. Covered by `opencode-resources.test.ts`. Authenticated cold catalog
  discovery was also checked live against 2.0.24 on 2026-10-07 (no prompt/session
  creation).

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

## Tool calls need chat identity and input aliases

- **Behavior:** direct host calls are named `superone_<tool>`; chat expects
  `mcp__superone__<tool>` so hidden metadata and designed host rows can route.
  Native `read` uses `path` in V2 (older inputs use `filePath`); `skill` uses
  `id` (older inputs use `name`). The chat contract is `Read.file_path` and
  `Skill.skill`. Camel-case edit fields also need chat aliases.
- **Observed:** V2 tool schemas, skills/MCP documentation and the reported
  October 2026 transcript; older 1.x field shapes are retained for compatibility.
- **Depends on it:** `opencode-event-map.ts#openCodeToolName/openCodeToolInput`
  normalizes both live adapters. Shared `tool-ui.ts`, tool presenters and remote
  input sanitization accept historical wire-shaped turns without rewriting storage.
  Only exact known host names are recognized; arbitrary single-underscore MCP
  ids cannot be split safely. This is display recognition, not permission admission.
- **Guard:** `opencode-v2-event-map.test.ts`, shared `tool-ui.test.ts` and
  `remote-tool-input.test.ts`, desktop `ToolBlock.opencode.test.tsx` (also renders
  the portable phone row). Storybook: `Tool UI/General/OpenCode Integration`.

## Patch and Code Mode are not ordinary string-edit/shell calls

- **Behavior:** V1 exposes `apply_patch`, V2 exposes `patch`; both carry a
  marker-based `patchText` with multiple add/update/move/delete targets. V2's
  `execute` runs JavaScript Code Mode, orchestrating catalog tools rather than
  running a shell command. Standard V1 tools do not include this Code Mode tool.
- **Observed:** [V1 tools](https://opencode.ai/docs/tools/#apply_patch) and
  [V2 tools](https://opencode.ai/v2/docs/tools), October 2026.
- **Depends on it:** live OpenCode names become `Patch` / `CodeExecution` in
  `opencode-event-map.ts`. Shared `NativeCodeToolRow.tsx` accepts older wire names
  and feeds the same independent Edit/Write/Delete rows as Claude Bash's changed-file
  area (each diff starts collapsed and honors file-diff settings). The patch header
  shows file/line totals, and output has its own disclosure. Code and output stay
  behind expand. `execute`
  is never mapped through Grok's shell alias for OpenCode.
- **Remote:** collapsed patch inputs contain validated paths/kinds/counts only;
  per-file diff bodies arrive through `toolDetail` on expansion. JavaScript source
  stays stripped from the phone transport. A language marker preserves historical
  `execute` identity without disclosing its script. Nested calls remain subject
  to their upstream permissions; rendering does not execute anything.
- **Guard:** `patch-tool.test.ts`, `remote-tool-input.test.ts`,
  `opencode-v2-event-map.test.ts`, `progressive-tools.test.ts`,
  `turn-process-stats.test.ts`, and `ToolBlock.opencode.test.tsx`.
- **Statistics:** collapsed patch headers and compact-mode Detail use the same
  file/line summary contract. Targets are deduplicated by path; each patch is one
  tool call regardless of its number of UI-only file rows. Failed/denied mutations
  are excluded from Detail. `ChatMessage.test.tsx` verifies the actual disclosure
  and header together; Storybook `PatchDetailStatistics` exercises both production
  surfaces rather than supplying mock totals.
