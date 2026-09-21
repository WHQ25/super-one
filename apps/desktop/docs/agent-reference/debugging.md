## Debugging

To show raw input/output for specific tool calls in the chat UI, set the `RENDERER_VITE_DEBUG_TOOL_NAMES` environment variable before running dev:

```bash
RENDERER_VITE_DEBUG_TOOL_NAMES=TodoWrite,TaskCreate bun run dev
```

- Comma-separated list of tool names (case-insensitive, partial match)
- Only works in development mode (`import.meta.env.DEV`)
- Matching tool blocks render a debug view with prettified JSON input and raw output instead of the normal UI

### Event Trace (SQLite)

`apps/desktop/src/main/agent/event-trace.ts` — dev-only SQLite trace for debugging data flow across layers. Auto-creates `event-trace.db` in `apps/desktop/` (the `bun run dev` cwd; cleaned on each run).

**Writing traces** (main process, synchronous):
```typescript
import { trace } from './event-trace'
trace('agent.sdk', 'assistant', sdkMsg)              // SDK raw message
trace('agent.emit', 'content_delta', event, msgId)    // emitted AgentEvent
```

**Writing traces** (renderer process, via IPC):
```typescript
window.app.trace?.('agent.store', 'content_delta', data, messageId)
```

**Source namespaces**: `agent.sdk` (raw SDK messages, tagged with messageId), `agent.emit` (translated AgentEvents, tagged with messageId), `agent.store` (Zustand store deltas), `remote.out` (stripped mobile events, derived by convert-trace). Extensible to `mcp.*`, `codex.*`, etc.

**Saving & converting recordings:**
```bash
# Save current trace DB as a named recording
./scripts/save-recording.sh claude-todos    # → scripts/recordings/claude-todos.db

# Convert agent.emit → remote.out (offline, re-runnable after changing strip logic)
bun run scripts/convert-trace.ts scripts/recordings/claude-todos.db
```

**Querying** (from terminal while app is running):
```bash
# Event overview
sqlite3 event-trace.db "SELECT source, type, count(*) c FROM events GROUP BY source, type ORDER BY c DESC"

# Trace a message across all layers
sqlite3 event-trace.db "SELECT id, ts, source, type FROM events WHERE tag='<messageId>' ORDER BY id"

# Recent events from a specific layer
sqlite3 event-trace.db "SELECT ts, type, data FROM events WHERE source='agent.sdk' ORDER BY id DESC LIMIT 20"
```

### Log File

In development mode, `electron-log` writes to `apps/desktop/dev.log` (relative to the dev cwd; configured in `apps/desktop/src/main/logger.ts`). The dev script auto-deletes the previous `dev.log` on each run to keep it small. When debugging main process issues, read this file to inspect logs instead of guessing. The log format is `[date time] [level] text`.

For packaged builds, electron-log uses the running variant's app name for its
log directory. Read the actual path for that variant rather than assuming
`SuperOne` for a dev or alpha build. `src/main/logger.ts` owns file logging;
`src/main/variant.ts` and `variants.json` own identity.

### Codex can chat but has no SuperOne tools

Packaged builds persist the following metadata in the normal application log;
no dev build or `RUST_LOG` setting is required. Correlate `connectionId`,
`sessionId`, `threadId`, and timestamps. Codex connects directly to the local
HTTP MCP server; third-party chat providers use a separate model proxy.

| Log | What it establishes |
|---|---|
| `[mcp-transport]` | The bridge bound its local HTTP port. A preceding `[mcp-stdio-ipc] failed to start` means injection may be absent even when chat starts. |
| `[codex.diagnostic]` / `mcp_config` | The thread start/resume received SuperOne's URL and auth header. `injected:false` means the bridge runtime was unavailable at configuration time. |
| `[mcp-http] request` | `initialize` and `tools/list` reached the server, with HTTP status and elapsed time. Failures include an allowlisted reason such as `unauthorized`, `invalid_host`, or `invalid_transport_session`. |
| `[codex.diagnostic]` / `mcp_startup`, `mcp_stderr` | Codex's startup result and redacted MCP warnings/errors, including failures that do not stop chat. |
| `[codex.diagnostic]` / `mcp_snapshot` | When the MCP status panel queries Codex: server presence, runtime/auth status, tool count, and discovery error. `hasNextPage:true` means absence on this page is inconclusive. |
| `[codex-mcp-tools]` | For the Responses-to-Chat proxy, tool counts before/after conversion, including direct SuperOne function tools and namespace counts. This establishes conversion output, not provider acceptance or model execution. |

For Windows reports, collect the app log around a fresh session and its first
turn, the SuperOne/Codex versions, and the MCP status panel result. An injected
config with no HTTP handshake narrows investigation to Codex config/startup or
local connectivity (including proxy/security software); it does not prove which
one failed. A successful handshake and forwarded tools move investigation to
provider/model tool calling. Diagnostics omit auth values, request bodies,
tool arguments, and schemas.

### Codex provider stalls in production

Search the main log for `[codex.diagnostic]`. These entries are enabled in packaged
builds and use `connectionId` to correlate with the existing app-server launch
(binary path) and initialization (runtime version) logs.

- `provider`: selected credential/endpoint, protocol, sanitized base URL, direct
  versus Chat Completions proxy route, and API key/proxy environment presence.
- `request_started` / `request_completed` / `request_failed`: proxy startup,
  initialization, thread creation/resume, and turn submission timings.
- `provider_error`: upstream error category, HTTP status when supplied by Codex,
  and `willRetry`, including retries that do not surface as terminal UI errors.
- `first_output`: first non-empty text or reasoning delta, without its contents.
- `waiting`: emitted every 60 seconds for pending lifecycle requests or active
  turns; includes elapsed time, latest notification, output presence, and the
  latest sanitized stderr warning when available. This does not cancel the turn.

For a user-specific failure, collect `main.log` and `main.log.old` immediately
after reproduction, the approximate time/session, and the working CLI version.
New diagnostics omit request/response bodies and redact known credentials and URL
query values. They do not require development mode or raw event tracing.

### Computer Use window discovery and dedicated displays

Search the packaged app's main log for `[computer-use.diagnostic]`. Collect the
log and rotated `.old` file soon after a report, together with its approximate
time and session. No development mode or event trace is required.

- `discovery`: connected display bounds/scales, ordinary window IDs/PIDs and
  on-screen status, returned inventory, app hidden state, AX failures and scan
  budget exhaustion. The additional all-window inventory is diagnostic only.
- `selection`: requested app/root, bounded candidate metadata and selected root
  (null on failure); titles are represented only by `hasTitle`.
- `placement`: requested display, original/target/readback bounds, `onTarget`
  using the existing 80 percent containment rule, and whether readback existed.
  This records the immediate result, not proof that later layout has settled.
- `placement_skipped` / `placement_ignored`: missing window ID or a placement
  failure ignored during observation under the existing policy.
- `capture` / `helper_failed`: capture coordinate space or native error code,
  correlated by session/window/PID where supplied. Error messages are omitted.

Identical entries are suppressed for 60 seconds. Inventories are capped at 80
windows/apps; counts and truncation metadata identify incomplete diagnostics.
Titles, UI text, input, image data and raw RPC payloads are not logged. The new
native inventory/placement fields require a rebuilt helper; an older helper
reports null diagnostics. Window selection, movement and failure policy are
unchanged by this instrumentation.
