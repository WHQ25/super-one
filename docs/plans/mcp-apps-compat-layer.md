# MCP Apps compatibility layer execution log

Scope: phase 1, local Cursor sessions and the MCP Apps fixture. Branch:
`feat/mcp-apps-compat`. Design: [compat layer](../proposals/mcp-apps-compat-layer.md).

## Plan

1. Discover local stdio App servers before Cursor receives its session list;
   retain one compat connection and omit only connected App servers. Cache
   non-App discovery by local node/config fingerprint including project cwd.
2. Add their model-visible tools to `miniapp_list` and dispatch through the
   existing `miniapp_call` permission decision. Retain private metadata host-side.
3. Return a random, session-scoped, once-claimable record marker in the first
   text block. Attach the record only to a real Cursor `miniapp_call` result.
4. Expose the compatibility `McpAppsProvider` to the existing View executor.
5. Run focused tests, node/web typechecks, and an isolated live fixture session.

## Findings (2026-10-01)

- Cursor's desktop runtime factory is async; its `buildMcpServers` callback is
  sync. Discovery belongs before factory/prewarm so the first turn waits for
  bounded discovery without blocking app startup. Each server gets 10 seconds.
- Normal stdio servers are probed only on a config-cache miss, then handed to
  Cursor. Connected App servers keep their discovery connection. A failed or
  timed-out probe stays native for that session. HTTP/SSE are native in phase 1.
- Client runs in main, loaded lazily at the first local Cursor session. The
  existing MCP App sandbox and provider RPC visibility gate are reused.
- Cursor SDK 1.0.30 `McpSdkClient.callTool` sends only `{name, arguments}`;
  its internal harness call id is absent from the MCP request. It also reduces
  the result to `{content, isError}`, dropping `structuredContent` and `_meta`.
  Structured content therefore also travels as a text block; private metadata
  only lives in the host record. The marker goes first to survive summary caps.
- Correlation uses a host UUID carried by that result, with session lookup and
  one-time consumption, then stamps the actual harness row id. It never uses
  tool arguments, name/args hashes, or FIFO matching.

## Verification

- 48 focused tests passed across compat record/session, mini-app execution,
  Cursor MCP mapping, backend interactions/interrupt/sandbox (7 files).
  Tests launch the real stdio fixture and exercise the real Cursor mapper and
  provider RPC gate. They cover private data, schema discovery, app-only/model-only
  refusals, deny before dispatch, completed errors, concurrent ids, forgery,
  replay, summary truncation, non-App cache/config invalidation, malformed
  visibility, timeout, and lifecycle replacement/late close.
- Fixture host/View operations run through the real host executor and provider
  RPC gate: initial HTML loading/snapshot persistence, app-only pagination,
  model-only refusal, restored snapshot without a provider call, activation,
  and host-attributed model context with no private tool metadata. These are
  integration checks; they do not prove real Cursor row rendering.
- `bun run typecheck:node` and `bun run typecheck:web` passed.
- Dev output keeps `compat-session` in a dynamically imported main chunk.
- Live booted with an isolated profile and scratch `.mcp.json`. The fixture log
  confirms compat `initialize` advertised `io.modelcontextprotocol/ui`, then
  `tools/list` ran. Cursor SDK auth status reports logged-in, but SuperOne's
  runtime separately requires a User API Key; the fresh profile has none and
  `CURSOR_API_KEY` is unset. Model turn stopped at that prerequisite. View
  rendering/pagination and model usability are not yet live-verified.
- Dev environment: default renderer port 5173 was occupied, so 5181 was used.
  The prescribed worktree profile exceeds macOS's Unix socket path limit
  (`listen EINVAL`). A short cwd `/private/tmp/claude-501/drew` runs the built
  current-worktree Electron main with `SUPERONE_INSTANCE=mcp-apps-compat`,
  renderer 5181 and CDP 9382. No user harness configuration was edited.
- Parent relayed the user's decision to accept the blocked Cursor live check
  (option 3). No ACP/Grok extension in this slice. Submit the tested local
  Cursor pilot with the live boundary explicit.
- The isolated Electron instance and renderer server were stopped; CDP 9382
  and renderer 5181 no longer have listeners.

## Remaining live checks

**The Cursor live model turn is not verified.** The isolated profile has no
Cursor User API key; the SDK's global login does not satisfy SuperOne's Cursor
runtime. Once that profile has a key, verify all of the following:

1. Start a fresh local Cursor session with the scratch fixture `.mcp.json`.
   Confirm Cursor receives only the native servers plus SuperOne, with the
   App fixture omitted, and no user config files changed.
2. Ask the model to discover the fixture with `miniapp_list`, inspect its
   schema, and call `fixture_list_items` through `miniapp_call`. Verify its
   executor approval; deny once and confirm no fixture call executed.
3. Accept the call. Verify the exact call row renders the View from its host
   record, with page 1 and private metadata kept out of model output.
4. Click Next page in that View. Verify the app-only `fixture_next_page`
   reaches the same server and updates the same View, and model-only calls
   from the View are rejected.
5. Restart/restore the session. Verify the saved snapshot paints without a
   provider call and outbound calls require Activate, then work after it.
6. Repeat with a natural request without explicit dispatcher instructions to
   assess model discovery/usability. No per-server usage hint is justified by
   the current evidence.
