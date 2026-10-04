# Grok ACP host integration

SuperOne launches the user's `grok agent stdio` as an ACP agent. Desktop uses
`apps/desktop/src/main/acp/acp-runtime.ts` and `session/backends/acp-backend.ts`;
the node uses `packages/acp/src/run-turn.ts`. Shared protocol mapping does not
mean the two runtimes expose every control equally.

See [permissions](grok-acp-permissions.md), [progressive notifications](grok-xai-ext-notifications.md)
and [backlog](backlog.md). This document describes code behavior, not a historical
capability count or a release checklist.

## Desktop runtime

- Initialize advertises ask-user and exit-plan extensions and the `superone`
  client identity. For Grok, host text-filesystem and terminal delegation are
  disabled: Grok uses its own local tools, including binary image reads. Other
  ACP agents can still use SuperOne's filesystem/terminal bridge.
- Session create/load passes MCP descriptors, explicit permission booleans and
  optional reasoning effort. Resume uses session load where supported.
- Cached-token/API-key authentication is noninteractive. Interactive login runs
  through the separate settings flow and must not stall session setup.
- Standard ACP messages become `AgentEvent`; xAI notifications supply workflow,
  child-agent, background-task, usage and settings state that is absent from the
  ordinary tool acknowledgement.
- The ACP runtime updates its plan state after `session/set_mode` succeeds.
  The session permission chip is written before that RPC. The permission
  baseline and reasoning effort remain separate.
- Cancellation asks the agent to stop and has a bounded local stop fallback so
  a missing upstream terminal response does not leave Stop permanently active.

## MCP controls

`authenticateMcp` calls `x.ai/mcp/auth_trigger` using `session_id` and
`server_name`, and checks the returned failure. The Grok MCP popup can expose
Log In when authentication is needed.

`reconnectMcp` removes and reattaches the selected server through the runtime's
server-update API; resending an identical list would not reliably restart it.
Server status, initialization progress, tools-changed and servers-updated
notifications maintain the runtime catalog. User MCP descriptors and the host's
own injected MCP server remain separate authorization domains.

## Queued messages and background output

Steer now is a replacement `session/prompt` with `_meta.sendNow`. The backend
keeps the session busy until that replacement completes. Steer soon uses
`x.ai/interject`; self-minted interjection IDs suppress the echoed user message.
A host queue remains as fallback when interjection is unavailable.

An agent-initiated wake can produce assistant content while no host prompt is
active. The runtime creates a wake scope on content and closes it on durable
`turn_completed`, an orphan stop or the next host prompt. Usage-only updates do
not create empty assistant bubbles. Slash-launched workflows can synthesize a
card through `packages/chat-core/src/host-workflow-card.ts` even without a launch
tool call in the transcript.

## CLI/node boundary

The node uses shared ACP event/permission/elicitation helpers, advertises ask and
exit-plan support, and consumes the shared xAI notification mapping. A Grok
launch initializes with host filesystem and terminal off, a production client
version from `resolveCliReleaseVersion()` (the in-repo package walk remains only
when the caller omits `clientVersion`), and explicit yolo/auto booleans. Other ACP
launches still send empty `clientCapabilities`. The node does not inherit the
desktop backend's live session controls, folder-trust dialog, or self-echo
filter merely by importing the mapper. Headless plan approval is cancelled when
no approving host path exists. Production turns use the harness-stored `grok`
binary with args `agent stdio`, resolved again on each ACP turn.

Do not enable a capability flag on the strength of desktop support alone.
The remaining node and extension work is recorded in [backlog](backlog.md).

## Verification

Use the scoped ACP runtime, permission, xAI mapper and backend tests for changes
here. Shared reducers cover workflow-card synthesis; mobile prompt components
cover phone presentation separately. A checked-in live JSON-RPC trace is not a
substitute for these tests and is not currently a release gate.
