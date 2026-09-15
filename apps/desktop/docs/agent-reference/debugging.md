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
