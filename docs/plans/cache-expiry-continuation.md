# Continue a cache-expired session in a new session

Status: completed (implementation merged to `main`) · Updated: 2026-10-16
Goal: When a long session's prompt cache has expired, the composer offers to continue in a new session that mentions the old one. The new session takes over the old session's collaboration channels, on desktop, mobile and remote nodes.
Long-term docs: [Session continuation](../features/session-continuation.md); [Composer](../features/composer.md); [Remote node service](../architecture/remote-node-service.md).

## Completion

The implementation is on `main` through `1abda5f82`. Commit `b140f492d`
retired the tracked plan and moved the final behavior into
[Session continuation](../features/session-continuation.md), which is the
authoritative specification. This copy records completion; the original design
below is historical and includes choices that changed during implementation.

- [x] Shared cache-expiry evaluation, Claude-reported TTL and settings validation.
- [x] Continuation drafts, session mentions, draft/attachment transfer and no prewarm.
- [x] Host `session.create { continuesFrom }`, succession records and creation guards.
- [x] Collaboration channels, messages, cursors and wake migration with successor redirects.
- [x] Local desktop, node-local and controller-owned remote-child continuation.
- [x] Desktop and mobile composer offers, settings integration and colocated stories.
- [x] Automated coverage added for detection, drafts, channel migration, create contracts and UI behavior.
- [x] Long-term feature, composer and remote-node documentation updated.

Final scope differs from the original design:

- TTL comes only from reported usage; there is no account-based TTL guess.
- The offer occupies the composer slot with **Approve** and **Dismiss**.
- Mobile follows the paired desktop's setting rather than a device-local preference.
- Succession is stored in `session_continuations`; the successor row is desktop-only.
- Remote creation transfers `externalParent`; no separate `session.clearExternalParent` RPC was added.

Verification for this status update: checked the merged commits, current source,
test coverage and long-term docs. No test suites were rerun for this
documentation-only change. The live desktop, node-lab and phone acceptance
scenarios in step 7 were not independently reverified; their results are not
asserted by this completion record.

## Original decisions (superseded by the feature doc)

- **When the hint shows.** All of these must hold:
  - the host knows the session's prompt-cache TTL (an unknown TTL never hints);
  - context tokens ≥ the threshold (default 300K, adjustable, with an on/off toggle);
  - time since the last turn ended ≥ the TTL;
  - the session is idle and writable.
- **Banner text.** "This session is long and its cache has expired." No numbers.
- **Actions.**
  - [Continue in New Session].
  - [Continue Here]: hides the banner until the next expiry.
  - [Don't Show Again]: turns the setting off.
- **What "Continue" creates.** A new session with the same project, cwd/worktree, harness, provider, model and effort. Its composer holds a session mention chip of the old session followed by the old session's unsent draft.
  - The draft moves on the acting device. Per-session drafts are device-local; desktop windows share one through the draft mirror.
- **Collaboration.** The new session A' takes over the old session A's channels:
  - spawn grants with a bound child, and started link grants (exactly `channelsFor`);
  - their messages, cursors and wakes.

  What stays with A:
  - handoff grants (they have no mailbox, and A's suggested-task cards look them up by A);
  - approved-but-unstarted grants (their `launchId`s live in A's transcript, so A' could not start them; A' requests anew).

  A's runtime is disposed. A remains a plain session.
- **Sidebar.** If A was a spawn child, A' nests under the parent automatically through the grant join. The old A becomes top-level history with a "continued in A'" row.
- **Surfaces.** Desktop and mobile in the first version.

## Facts the design rests on

- **Context size.**
  - Desktop persists it as `sessions.context_tokens` (`apps/desktop/src/main/database-migrations.ts:155`), and it reaches mobile (`apps/mobile/src/runtime.ts:212`).
  - The node runtime never tracks it, so a cold-opened node session reads 0 until its next turn.
  - Never poll `session.contextUsage`. It touches activity and can respawn a released Claude runtime (`apps/desktop/src/main/session/backends/claude-backend.ts:888`).
- **Turn end.** The newest assistant `metadata.completedAt` (`packages/shared/src/message-completed-at.ts:7`). It is stamped on desktop (`session.ts:2352`) and on the node (`message-catalog.ts:460`), and persisted with the transcript.
- **TTL.**
  - Usage carries it in `cache_creation.ephemeral_{1h,5m}_input_tokens`. The Claude mapper reads only the flat cache fields (`packages/claude/src/agent-event-mapper.ts:170`).
  - The SDK default is 1h "on a Claude subscription within its usage limits" and 5m on API key, Bedrock, Vertex or Foundry. User `promptCacheTtl` / `CLAUDE_CODE_PROMPT_CACHE_TTL` overrides it, and SuperOne loads user settings (`claude-query.ts:145`).
  - The account kind is known only in the host process (`apps/desktop/src/main/agent/harness-usage.ts:89-96`, `main/index.ts:2461`).
- **Lazy creation and prewarm.** The renderer creates the host session on first send (`stores/chat-store/helpers/session-turn.ts:166-170`). A prewarm 10s after the draft has text already creates a live Session under the draft id (`store-helpers.ts:64,84`, `agent-service.ts` ~1027). `ensureHostSession` then skips `session.create`.
- **Desktop create.** `createDesktopSession` runs `deps.edits.create` and then `deps.sessions.createSession` with only `input.systemPromptAppend` and the draft settings (`node-host/desktop-session-create.ts:63-78`). The grant-derived prompt and run config are applied only in `loadSession` (`main/index.ts:484-511`).
- **Collaboration rows.**
  - Every route keys on session ids: grant endpoints, message `sender`/`recipient`, cursors, and `collaboration_wakes.session_id`.
  - Wakes deduplicate on `(session_id, notification_id)`, and admitted rows are kept for that (`packages/runtime/src/collaboration/wake-queue.ts:43,82-85`).
  - Desktop tables cascade on `sessions` delete (`database-migrations.ts:645-697`). Node tables have no FKs.
  - Unique indexes (`packages/runtime/src/collaboration/schema.ts:31-35`) cannot conflict for a fresh A'.
- **Where grants live.**
  - Desktop parent with node children: the grant is in the desktop DB. The node keeps only `externalParent` and the prompt append. The controller resolves the parent from the grant (`collaboration-remote.ts`).
  - Node-local collaboration: the node DB (`apps/cli/src/session/collaboration.ts`).
  - Links never cross machines.
- **Lineage.** None exists. Forks copy no grants. Handoff grants are one-way.

## Steps

### 1. Detection data (host-resolved)

- **Claude mapper.** Map `usage.cache_creation.ephemeral_{1h,5m}_input_tokens` to `metadata.usage.cacheTtl: '5m' | '1h'` when a turn wrote cache.
- **Host resolution.** Each host resolves `SessionSnapshot.promptCacheTtl: '5m' | '1h' | null`, on desktop and on the node:
  1. the newest reported `cacheTtl`;
  2. otherwise, Claude account providers and a default login with a subscription get `1h`;
  3. the built-in `anthropic` API-key platform gets `5m`;
  4. custom, third-party, Bedrock and Vertex get `null` until a turn reports a TTL.

  Mobile reads the snapshot and never guesses.
- **Capability.** `promptCacheTtl: 'reported' | null` in `HarnessCapabilities` (`packages/shared/src/harness/harness-capabilities.ts`). It is `'reported'` for Claude and `null` elsewhere.
- **Context size fallback.** When `contextTokens` is 0 (cold node session), use the newest assistant `metadata.usage` (input + cacheRead + cacheCreation).
- **Shared evaluator.** A pure `continuationHint({ ttl, contextTokens, lastCompletedAt, now, status, readOnly, threshold, enabled })` in `packages/shared`, used by desktop and mobile.
- **Settings.**
  - Desktop: `AppSettings.sessionContinuationHint { enabled, minContextTokens }` (clamped 100K–1M), plus a `settings-registry.ts` entry.
  - Mobile: a device-local Kv preference (`apps/mobile/src/mobile-preferences.ts`).

### 2. Continuation draft and create contract

- **Continue action.** It creates a `DraftRecord` (draft.* RPC) whose `settings.continuesFrom = A`, with the merged document (mention chip + A's draft). It then opens the draft through the existing resume path (`lib/draft-resume.ts:233-258`).
  - It clears A's draft, attachments and mentions through the store, so `composer-draft-mirror` clears other windows.
- **Carrying `continuesFrom`.**
  - Add it to `DraftSessionSettings` (`draft-rpc.ts:46`) and `PerSessionState`.
  - Map it in `snapshotDraftSettings`, `sessionFieldsFromSettings`, `buildUpsertFromSession` (`draft-promote.ts:135,181,482`) and `draftSettings()` (`session-turn.ts:105-118`).
  - On mobile, add it to the settings builder and `restoreDraft`/`apply` (`use-mobile-draft-session.ts:33-63`), to `remote-draft-codec`, and to `createSessionPayload`.
- **Always create.** Continuation drafts are never prewarmed. `ensureHostSession` treats `continuesFrom` like a harness mismatch: it removes any prewarmed empty session and always calls `session.create`.
- **Create contract.**
  - `continuesFrom` is a top-level field of `SessionCreateRequest` (`packages/shared/src/environment/session-requests.ts:48`).
  - It is parsed in `packages/runtime/src/server/rpc-session-create.ts` and passed to both `createOnHost` (desktop-as-node) and `ctx.sessions.create` (CLI).
  - `session.create` is already a mutating method.
- **Succession record.**
  - Desktop: `sessions.continued_from_session_id`, nullable with no FK. Bump `SCHEMA_VERSION` (`apps/desktop/docs/agent-reference/architecture.md` migration section).
  - Node: a field on the node session record.
  - A's "continued in A'" row reads the reverse lookup.
- **Before first send.** A still holds the identity until A' is created. A wake in this window runs A, and the create then fails the precondition, so the composer keeps the draft and says why. Document this in the feature doc.
- **Reminder.** No new tag. When `continuesFrom` is set, the existing `<superone-session-reminder>` for the mention (`send-message.ts:196-222`) gains a line: "This session continues it; collaboration peers moved here: …". The peers list is filled by the host at create time.

### 3. Collaboration channel migration (same machine)

- **Ordering on desktop.** In `createDesktopSession`, after `deps.edits.create` and before `deps.sessions.createSession`, one synchronous `db.transaction`:
  - **Recheck preconditions:**
    - A is idle, with no background tasks;
    - A has no pending interaction;
    - A has no wake in `preparing` or `dispatching`;
    - A has not already been continued.
  - **`CollaborationStore.migrateChannels(A, A')`:**
    - channel grants: endpoints A → A';
    - those grants' messages: `sender_session_id` and `recipient_session_id`. This is needed for the cascade on A's delete and for the `UNIQUE(credential_hash, sender_session_id, client_message_id)` idempotency keys. `fromSessionId` attribution becomes A';
    - cursors.
  - **`CollaborationWakeQueue.migrate(A, A')`** (a new method). It moves every row for A that is not in flight (`queued`, `admitted`, `failed`, `uncertain`), so deduplication still holds. It also moves the `collaboration_wake_recipients` row and the in-memory `paused` Set.
  - **Write the succession record.**
- **Creating A'.** Then call `createSession` with `getSessionCollaborationSystemPrompt(A')` and `getSessionCollaborationRunConfig(A')` (permission, sandbox, service tier). This closes the gap where a child A' would run without its prompt or approved run config.
- **After commit:**
  - dispose A's runtime;
  - `notifyCollaborationSessionsChanged`;
  - mailbox `changed` for A and A'.
- **Node.** The same transaction runs in the CLI `CollaborationService` from `session.create`. A' gets `launchedSessionPromptAppend(grant)` through `setSystemPromptAppend` (`apps/cli/src/session/collaboration-profiles.ts:184-195`), which includes profile instructions.
- **Successor redirect.** Hosts inject a `successorOf(sessionId)` lookup into the runtime collaboration helpers. Peers whose prompt still names A then keep working:
  - `resolveSendChannel` `to` (`packages/runtime/src/collaboration/mailbox.ts:139`);
  - `readCallerMailbox` `from` (`:203-212`);
  - link requests naming A.
- **Not needed.**
  - Clearing `pendingStopWake`: A''s first run clears it through `clearStopWakeOfChild` (`collaboration-lifecycle.ts:231-233`).
  - Touching the monitor's `runs`/`stalls`: they are empty for an idle A.
- **Nested-collaboration rule.** It holds: A' becomes the spawn child, and A becomes top-level.

### 4. Remote nodes

The host that owns the grant orchestrates.

- **Continuing a desktop parent P that has node children.** Migrate locally. Children keep their prompt naming P; the controller resolves the parent from the grant, and the successor redirect covers an explicit `to: P`. No node call, so the children's caches are untouched.
- **Continuing a node child C of a desktop parent.** The desktop intercepts the renderer's remote `session.create` (`session-turn.ts:176` → `remote-environment-gateway.ts`) when `remoteChildTarget(C)` is set:
  1. Read the node `eventHead` (as `collaboration-remote.ts:315` does).
  2. Create C' on the node with `externalParentSessionId` and `systemPromptAppend`.
  3. Create C''s hidden local row (`createSessionRecord` + `hideSession`, as at `collaboration-start.ts:462-463`).
  4. Migrate the grant and reset `config.remote.eventCursor`/`run`.
  5. Call `session.clearExternalParent(C)`.

  This migration runs while `RemoteChildWatcher` is not polling (await its running tick). `save()` also rechecks `grant.child_session_id === sessionId` against a fresh read (`collaboration-remote-watch.ts:206-219`). C's watcher entries are unwatched.
- **New node RPC `session.clearExternalParent({ sessionId })`.**
  - It clears `externalParent` and the prompt append on the record (`packages/runtime/src/session/sqlite-session-store.ts:137`), so the old C no longer forwards mailbox tools.
  - Add it to `NODE_MUTATING_METHODS`, with the `operateSession` scope and lease checks.
- **Node-local collaboration.** Covered by step 3 through node `session.create`.
- **Desktop-as-node hosts** (`createOnHost` with a controller record, `desktop-session-host.ts:445-455`). They handle `continuesFrom` the same way as the CLI.
- **Child hosted for another controller** (`remote_controller_json.externalParent`). The local host does not own the grant, so create refuses with "continue it from the device that started the collaboration". The controller uses the node-child path above.

### 5. Desktop UI

- **Banner placement.** A `SessionContinuationBanner` in `ChatInput` before `<PluginStatusLines>` (`ChatInput.tsx:2024`, `mx-3 mb-1`).
  - It renders only in the text composer, so decisions, read-only states and remote locks suppress it.
  - It reevaluates when shown and at `lastCompletedAt + ttl` via a timer. It never polls the host.
- **On A after continuation.** A "continued in A'" row with an open action.
- **Stories, colocated:**
  - hint;
  - narrow, dark and zh;
  - create refused (precondition error);
  - continued-in row;
  - a seeded `ChatComposerShell` story.

### 6. Mobile UI

- **Banner placement.** A native banner in `apps/mobile/src/screens/chat-composer.tsx` beside the status row (`:271`). It uses the shared evaluator, the snapshot `promptCacheTtl`, and the Kv preference.
- **Continue.** Create the continuation `DraftRecord` and open it with `use-mobile-draft-session.ts` `apply`. Clear the old composer draft (`composer-session-drafts.ts`).
- **Strings.** A per-feature file in `apps/mobile/src/i18n`.
- **Stories.** In `chat-screen.stories.tsx`: light, dark, zh-narrow, and the continued-in row.

### 7. Tests and acceptance

- **Unit tests, extending the existing suites:**
  - **Runtime `collaboration/{mailbox,schema,wake-queue}.test.ts`:**
    - channel-only migration, with handoff and unstarted grants staying;
    - sender, recipient and cursor moves;
    - non-in-flight wake rows moved, and dedup preserved;
    - in-flight wakes refused;
    - successor redirect for `to`, `from` and link.
  - **Desktop `collaboration-{lifecycle,wake-delivery,remote-watch}.test.ts` and `session-collaboration.test.ts`:**
    - create passes the child prompt and run config;
    - watcher save after migration;
    - A disposed.
  - **CLI `collaboration.test.ts` and `collab-wake.integration.test.ts`:** node-local continuation; `clearExternalParent`.
  - **`rpc-session-create` tests:** `continuesFrom` parsing, and preconditions on both host kinds.
  - **Draft-promote tests:** the `continuesFrom` round trip, and no prewarm for continuation drafts.
  - **Shared:** the evaluator, Claude TTL parsing, host TTL resolution (custom provider → null), and settings sanitizing.
- **Live, desktop.** Lower the threshold and set `CLAUDE_CODE_PROMPT_CACHE_TTL=5m`.
  1. A parent with two spawn children: wait for expiry, continue, and check that the children's reports wake only A'.
  2. Continue a child: check that the parent's messages reach C', and that C' runs with the child prompt and the approved permissions.
- **Node lab** (`bun run dev:cli:lab`).
  1. A desktop parent with node children: continue the parent, then continue a child.
  2. A node-local parent: continue it.
- **Phone.** The banner appears; Continue moves the draft; the session is created on first send.

## Open questions

- Background subagents and workflows may keep the main cache warm after the turn ends. Then `completedAt` underestimates warmth. The first version accepts this.
- "Don't Show Again" is device-local in the first version.
