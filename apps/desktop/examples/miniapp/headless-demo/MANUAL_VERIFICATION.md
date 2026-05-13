# Manual Verification — Headless Tools Feature

End-to-end smoke test for `feat/miniapp-headless-tools`. Covers all 9 features:
manifest schema, worker spawn, peer.emit/peer.on, KV proxy (worker↔SQLite↔iframe),
`@` mention popup, authorize on send, lazy-open panel, tool description enhancement,
session-sticky activation.

The example app at `apps/desktop/examples/miniapp/headless-demo/` exercises everything.

---

## Setup

```bash
# 1. Make sure you're on the feature branch
git status   # expect: On branch feat/miniapp-headless-tools

# 2. Start dev
bun run dev
```

Wait for the app window to open and reach the project view.

---

## Step 0 — Install the demo app (dev mode)

The demo app uses `"isDev": true`. Easiest install path:

1. In SuperOne, click the **Apps** panel in the sidebar.
2. Click **Add dev mini-app** (or use the existing dev-registry mechanism).
3. Point at `apps/desktop/examples/miniapp/headless-demo/` as the source dir.
4. Confirm install — should succeed; manifest schema validates `headlessEntry`.

**Expected**: `Headless Demo` appears in the Apps list with the default icon.

**Verify schema validation works** (negative test):
- Temporarily edit `manifest.json` and delete the top-level `"headlessEntry": "service.mjs"` line.
- Try to re-install or refresh the dev app.
- **Expected error**: `manifest.headlessEntry is required when any tool declares canCallWhileClosed=true`.
- Restore the line before continuing.

---

## Step 1 — `@` mention popup includes mini-apps

1. Open or create a chat session in any project.
2. Click in the chat input. Type `@` (with English keyboard).
3. **Expected**: popup appears with `Headless Demo` (or `headless` matching) at the **top** of the list, marked with a small `mini-app` badge. Files/agents come below.
4. Type `@hea` to filter.
5. **Expected**: `Headless Demo` remains; non-matching items disappear.
6. Click `Headless Demo` (or press ↵ when it's selected).
7. **Expected**: A chip with the mini-app's icon appears inline in the chat input, displaying `Headless Demo`. The text cursor sits after the chip.

**Don't send yet.**

---

## Step 2 — Authorize on send + headless worker execution

Type after the chip: `increment by 5`. Full input: `@Headless Demo  increment by 5`.

Send.

**Expected sequence** (verify each):

1. Within ~50ms: the agent's MCP tool list should now include `demo__increment`, `demo__read_counter`, `demo__reset`, `demo__show_counter`. (How to inspect: enable `RENDERER_VITE_DEBUG_TOOL_NAMES=demo__` env var, or check `apps/desktop/dev.log` for `[superone-mcp] registered tool demo__increment (headless=true)`.)

2. Agent should recognize the intent and call `demo__increment` with `{ by: 5 }`.

3. Tool block in chat renders, ~30-50ms after agent's tool_use event.

4. Tool block result: `{ "ok": true, "previous": 0, "value": 5 }`.

5. `dev.log` line: `[superone-mcp] registered tool demo__increment (headless=true)`.

6. `dev.log` line: panel did NOT auto-open (only `headless tool` execution).

**If agent doesn't call increment automatically**: this can happen with some prompt phrasing. Try a more direct prompt: `@Headless Demo Please call the increment tool with by=5`.

---

## Step 3 — KV persistence + cross-call state

Without closing the session, send a new message: `@Headless Demo what's the current counter value?`

(Note: you may need to `@`-mention again because session-sticky activation persists tools, but agent might lose context. The TOOLS stay registered.)

Actually — try sending **without** `@`-mention: `what's the current counter value?`

**Expected**: agent calls `demo__read_counter` (tools still in MCP from previous activation). Returns `{ value: 5 }`. **This proves session-sticky activation works.**

Send: `Please increment by 3`. Agent calls `demo__increment` with `{ by: 3 }`. Result: `{ value: 8 }`.

**Expected**: KV state persisted between two separate worker spawns. Each worker is fresh, but KV reads previous value.

---

## Step 4 — `peer.on` from worker to iframe

While the previous session is still alive, **open the panel** for `Headless Demo`:

- Click on `Headless Demo` in the Apps sidebar, OR
- Drag the app into the canvas/panel area.

**Expected**: panel slides in showing the counter card. The big counter number displays `8` (or whatever current KV value).

Now in chat, send: `@Headless Demo increment by 100`.

**Expected**:
- Tool block in chat renders.
- Within ~50ms after the tool completes, the **panel counter** jumps from 8 → 108 with a brief orange flash.
- The "peer.emit log" card in the panel adds a new row: `count-changed: value=108 delta=100`.

**This proves**: worker → main → broadcaster → renderer → iframe filter (by appId) → `superone.peer.on('count-changed', ...)` fires.

Send: `reset the counter`. Agent calls `demo__reset`.

**Expected**: panel counter → 0, log gets `count-changed: value=0 delta=0 (reset)`.

---

## Step 5 — KV bidirectional sync

In the panel UI, click **Local +1 (iframe writes KV)**.

**Expected**:
- Panel counter increments by 1 (e.g., 0 → 1).
- Log shows `local +1 → 1 (iframe writes KV; worker won't see via peer because no emit)`.

Send `@Headless Demo read the counter` in chat.

**Expected**: agent calls `demo__read_counter` (worker). Result returns `{ value: 1 }` — **the worker reads the value the iframe just wrote via KV**. This proves KV is a shared store across iframe + worker.

---

## Step 6 — Lazy-open panel for UI tool

**Close the panel first** (click X on the panel, or "Quit miniapp").

Wait until panel is fully closed.

Send in chat: `@Headless Demo show the counter in the panel`.

**Expected sequence**:
1. Agent sees tool list (still includes `demo__show_counter` from session-sticky activation).
2. Agent decides to call `demo__show_counter` (description hints: "(Note: this tool requires the mini-app's panel UI to be open to execute.)").
3. MCP server detects panel is not ready → fires `MINIAPP_LAZY_OPEN_REQUEST`.
4. Panel **automatically slides open** (within ~200-1500ms).
5. iframe loads, fires `MINIAPP_IFRAME_READY`.
6. `executeAppTool` resolves, panel iframe's `superone.tools.handle('show_counter', ...)` runs.
7. Tool block in chat shows `{ value: <whatever>, source: "panel-iframe" }`.

**This proves**: lazy-open mechanism works; tool description enhancement correctly signaled the side effect; UI tool runs in iframe (not worker).

---

## Step 7 — Tool description enhancement

In the chat (panel still open), open the **Debug** view if available (`RENDERER_VITE_DEBUG_TOOL_NAMES=demo__show_counter bun run dev`).

Or directly inspect via SDK tools/list — find `demo__show_counter` entry.

**Expected**: its `description` field ends with:
```
(Note: this tool requires the mini-app's panel UI to be open to execute.)
```

And `demo__increment` does NOT have that suffix.

---

## Step 8 — Session reset clears activation

Start a **new chat session** (or new project).

In the new session, send: `what's the counter value?` (no `@`-mention).

**Expected**: agent should NOT see `demo__*` tools — they're not in MCP for the new session. Either:
- Agent says it doesn't have access to a counter tool.
- Or it tries something else.

This proves session-isolation of authorization.

---

## Step 9 — Per-tool timeout

Modify `service.mjs` temporarily to add a slow handler:

```js
superone.tools.handle('slow', async () => {
  await new Promise(r => setTimeout(r, 30000))
  return 'done'
})
```

Add to `manifest.json` tools array:
```json
{
  "name": "slow",
  "description": "Test timeout",
  "inputSchema": { "type": "object" },
  "canCallWhileClosed": true,
  "timeoutMs": 2000
}
```

Reload dev app. Send `@Headless Demo call the slow tool`.

**Expected**: tool block displays error within ~2 seconds: `[Error] Tool 'slow' timed out after 2000ms`.

**Revert the temporary manifest change** before finishing.

---

## Step 10 — Multi-app activation

Install another simple mini-app (or use existing `hello`).

Send: `@hello @Headless Demo do whatever`.

**Expected**: both apps' tools registered to MCP for the session. Agent can call tools from either.

`dev.log` should show two `registerAppTools` lines.

---

## Diagnostic toolkit

When things go wrong:

| Symptom | Where to look | What to check |
|---|---|---|
| `@` popup doesn't show mini-app | DevTools Console | `useMiniAppStore.apps` populated? |
| `agent doesn't see tool` | `dev.log` | `[superone-mcp] registered tool ...` line present? |
| `worker tool times out` | `dev.log` | Look for spawn errors, bootstrap-error messages |
| `peer.on doesn't fire in panel` | DevTools Console (iframe) | `transport.on('miniapp-peer-event')` registered? |
| `KV doesn't share` | SQLite | `sqlite3 <installDir>/data/main.db "select * from __miniapp_kv"` |
| `lazy-open never resolves` | `dev.log` | `notifyAppReady` was called? Look for `app ready` log |

---

## Cleanup

```bash
# Remove the demo app installation
# In SuperOne: Apps > Headless Demo > Uninstall
```

---

## Pass criteria

All 10 steps complete with the described "Expected" outcomes. Any deviation
warrants a closer look at the implementation in:

- Manifest: `apps/desktop/src/main/miniapp/miniapp-schema.ts`
- Worker host: `apps/desktop/src/main/miniapp/miniapp-worker-host.ts`
- Peer bus: `apps/desktop/src/main/miniapp/miniapp-peer-bus.ts`
- KV: `apps/desktop/src/main/miniapp/miniapp-kv.ts`
- MCP dispatch: `apps/desktop/src/main/mcp/superone-mcp-server.ts` (lines 163-230)
- Authorize: `apps/desktop/src/main/index.ts` (`MINIAPP_AUTHORIZE` handler)
- Lazy-open: same file, MCP server `requestLazyOpenPanel`
- @-mention: `apps/desktop/src/renderer/src/components/chat/MentionPopup.tsx`
- iframe runtime: `packages/shared/src/miniapp-api-runtime.js` (peer + kv)
- Worker runtime: `packages/shared/src/miniapp-headless-runtime.js`
