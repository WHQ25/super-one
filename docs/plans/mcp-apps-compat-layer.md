# MCP Apps compatibility layer execution log

Scope: phase 1, local Cursor sessions and the MCP Apps fixture. Branch:
`feat/mcp-apps-compat`. Design: [compat layer](../proposals/mcp-apps-compat-layer.md).

## Plan

1. After the user's Cursor opt-in, discover local stdio App servers before
   Cursor receives its session list;
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

## Review follow-up (2026-10-01)

- Sandbox requests now skip compat before discovery in both create and prewarm.
  Any prior client closes and native servers return to the SDK list. The gate
  uses the same session-over-config precedence as the core, conservatively
  retaining native routing even if platform support would later disable sandbox.
- Pending host records now have a per-session cap of 32, evicting oldest first,
  and a five-minute TTL. One unref'ed expiry timer releases idle records without
  needing another turn; claim/close cancel or reschedule it. Attached records
  already transferred to the transcript are unaffected.
- SDK source proves independent team MCP/network restrictions: its internal
  dashboard provider fetches `getTeamAdminSettingsOrEmptyIfNotInTeam`, caches
  settings in memory for 300000 ms, and derives policies with a feature gate.
  Public SDK exports contain no policy query or team-service injection, no
  durable policy cache was found, and `Cursor.me()` / existing SuperOne account
  resources do not expose membership or restrictions. Personal user ids cannot
  prove policy absence. This unresolved bypass risk was reported to the parent
  for a user release/gating decision; no private API access or inference added.
- New focused checks cover sandbox create/prewarm and config precedence, cap
  eviction, independent deadlines, idle expiration and close timer cleanup.
  30 tests passed across five affected files; node/web typechecks and
  `git diff --check` passed. No further live model verification was attempted.

## User opt-in decision (2026-10-01)

- Parent relayed the user's decision: Cursor rerouting is off by default and
  enabled manually. Added `mcpAppsCompatEnabled` to the existing `cursor-base`
  config, shown in Settings → Harnesses → Cursor → Preferences, with en/zh
  copy plainly describing the team MCP allowlist/network/sandbox bypass.
- No opt-in means no compat discovery, client or server omission. Explicit
  opt-in keeps the existing local stdio pilot, still skipping sandbox requests.
  The existing save path marks Cursor sessions for rebuild and refreshes their
  config; switching off closes the compat client at the next start/rebuild.
- Parent agreed this field must not be exposed through agent config tools:
  agents cannot enable a policy-bypass setting. Cursor base runtime preferences
  were already absent from those registries. Added a field comment and a
  registry rejection test to preserve that boundary; no parallel settings store.
- SDK 1.0.30 team-policy detection remains unavailable. The opted-in path does
  not enforce those private policies; the user accepts that disclosed boundary.
- Settings stories cover off/on/saving, en/zh, 320px width and dark mode using
  the production row. Live Storybook inspection checked off → on interaction,
  280px card client/scroll width equality in en/zh narrow cases, control bounds,
  and Chinese dark presentation with no console errors. This verifies settings
  presentation, not the still-blocked live Cursor model/View turn.
- Verification: 48 desktop tests passed across five affected files, plus seven
  Cursor config tests. Node/web typechecks and `git diff --check` passed.
  The settings preview tab and Storybook server were closed after verification.

## Shared-contract rebase (2026-10-01)

- Rebased the pilot onto `9bc78a5ac`, including the model-context / `ui/message`,
  CAS resource, Codex catalog-refresh and forms work. Resolved the feature-doc
  overlap by retaining both the shared lifecycle description and compat record
  correlation. No shared contract or executor implementation changes needed.
- Compat implements `tools({ refresh: true })` for the shared gate's missing-tool
  retry. Default reads stay cached; concurrent refreshes share one paginated
  request chain with a 10-second deadline, 100-page bound and 10-second cooldown.
  Refreshed descriptors keep server attribution and normalized visibility.
  Known visibility denials never trigger discovery.
- Moved `boundedToolAppAttachment` into the record boundary so every producer
  follows the shared omission policy. Initial results can use the same 8 MiB
  transient output ceiling as View calls; above the 1 MiB persisted-data budget,
  the record marks the omitted result and keeps the working View.
- The production compat path already uses the shared executor's CAS persistence.
  Updated the fixture integration to use the actual resource store: saved
  attachments contain only hash/meta, a new store hydrates HTML from disk without
  a provider call, and Activate preserves the saved hash. A shared delta-merge
  regression checks that late tool results preserve CAS and model context.
- Verification: the original seven compat files plus Cursor runtime and
  settings regressions passed (90 tests / 10 desktop files), as did the seven
  Cursor config tests, node/web typechecks and `git diff --check`. The package
  config run needed unsandboxed execution after sandbox DNS failed to resolve
  localhost. The accepted live Cursor API-key boundary is unchanged; no new
  GUI or model claim is made by these integration tests.

## Remaining live checks

**The Cursor live model turn is not verified.** The isolated profile has no
Cursor User API key; the SDK's global login does not satisfy SuperOne's Cursor
runtime. Once that profile has a key, verify all of the following:

1. Enable MCP Apps Compatibility in Cursor Preferences, save it, then start a
   fresh local Cursor session with the scratch fixture `.mcp.json` and sandbox off.
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

## Other harnesses (survey, 2026-10-02)

Deferred by the user; recorded so the work can resume without a new survey.

**No Claude-style side channel.** ACP, OpenCode and dsh hand SuperOne only
the text of an MCP result: `structuredContent` and `_meta` are gone, and none
of them can run a View's tool call on its own connection or advertise the UI
extension. A SuperOne connection beside the harness would give the View
partial data and a second server process, so each needs the rerouting path.

**Reuse.** `compat-session.ts`, the SuperOne server's catalog and the
`miniapp_call` dispatch are harness-neutral. Harness-specific: the call name
`CALL_NAME` in `compat-records.ts`, and the summary text written for a harness
that keeps only `content`. Discovery is local stdio only. Cursor's hook points
(per harness): an opt-in gate and lazy `prepareCompatSession`
(`cursor/cursor-runtime.ts`), discovery awaited before the runtime and
prewarm, the `omittedServers` filter (`cursor/cursor-mcp.ts`), `compat.attach`
in the event callback, the backend's `getMcpAppsProvider`, and close.

| Harness | Omit per session | Result | Native route | Blockers |
|---|---|---|---|---|
| ACP (Grok, `opencode acp`) | Yes: `buildAcpSessionMcpServers` (`acp/acp-mcp.ts`), also re-sent by Grok's update-servers extension. Not Grok's own TOML servers | Text, capped at 4000 chars (`packages/acp/src/tool-result-map.ts`); `toolCallId` | Only the unstable MCP-over-ACP transport (`mcp.acp`), if Grok advertises it | Grok sandboxes its process; rerouted servers run outside it, like Cursor's team controls. ACP re-emits `tool_use`; a re-emit under another name would miss the record |
| OpenCode | Yes: `syncMcpServers` adds shared-config servers per `opencode serve`; servers from its own `opencode.json` need a per-session disconnect; a shared `serverUrl` has no session isolation | `part.state.output` string; `callID`; upstream cap unchecked | No: SDK has no resource read or client tool call | The row name is `superone_miniapp_call` (`openCodeToolName` passes it through), so `CALL_NAME` never matches; `miniapp_call` may also trigger OpenCode's own permission prompt |
| dsh | No: servers come from dsh's `cordis.patch.yml`, mounted once for every session (`packages/deepseek/src/mcp-servers.ts`) | Text blocks only; `toolCallId`; an `isError` result is thrown as text (marker survival unchecked) | Partly: the in-process client can read resources but drops tool `_meta.ui` and has no direct tool call | Needs a decision first: omit App servers globally or scope servers per agent. Shell sandbox does not cover rerouted servers |

Suggested order: ACP (one filter plus `attach`, Cursor-style opt-in and
disclosure), then OpenCode (make the call name a `CompatRecords` parameter),
then dsh after its scoping decision.
