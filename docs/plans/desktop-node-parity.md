# Desktop node parity

Status: in progress · Updated: 2026-10-14
Goal: A controller desktop (A) uses a paired desktop node (B) as if it sat at B: every session and terminal, Git, workspace files, the composer catalogs and the configuration families, with the same contracts A already uses against a CLI node.
Long-term docs affected: [remote-node-service.md](../architecture/remote-node-service.md) (§ desktop node, control leases), `apps/desktop/docs/agent-reference/architecture.md` (lease actors), [desktop-node-orchestration.md](desktop-node-orchestration.md) (scope lines superseded)

This is phase 5 of [unified-remote-protocol.md](unified-remote-protocol.md)
("Git/workspace parity on the desktop node, configuration families"). It
reverses the earlier policy that B shows a controller only the sessions it
started and keeps terminals, files, Git and settings with B's user.

Decided 2026-10-14: phones and controllers are served from **one** context
(today's `phoneContext()`, also used by B's window). Methods, policy and the
secret boundary are the same for both; differences come only from the
authenticated client (lease actor, client-scoped methods), never from a
second context. The secret boundary is the phone's: no decrypted credentials
or bundle export leave B.

## Starting point (verified 2026-10-14)

Symptom: starting a session on B from A shows no models and "Git Unavailable".
B answers `provider.listModels` and `git.status` with
`unsupported method on this environment`.

| Piece | Where | State |
|---|---|---|
| Controller context | `node-host/desktop-domain.ts` `rpcContext()` | `DesktopSessionHost`, `desktopCollaborationPort` (listProfiles only), `createDesktopWorktreePort` (fetch, worktreeActivate), no providers/workspace/terminals/drafts/extensions; `DESKTOP_UNSERVED_METHODS`. |
| Phone / window context | `phoneContext()` (also `environment/in-process-rpc-client.ts`) | `LocalSessionHost` (all sessions), runtime `WorkspaceGitService`/`WorkspaceFsService`/watches, terminals, drafts, phone extensions (`remote/phone-methods.ts`). |
| Session hosts | `node-host/desktop-session-host.ts`, `local-session-host.ts` | Share `DesktopSessionReads` and one `EventLog`. Only `DesktopSessionHost` writes `remote_controller_json` on create, keeps B's active session, restores controller leases and launch settings after restart, serves Host Actions and labels collaboration tasks. Only `LocalSessionHost` serves fork/setCwd/tags/uiFlags/close/remove/modUi, side chats, scheduled sends, inbox, rewind. |
| Leases | `packages/runtime/src/lease/control-lease.ts:130`, `terminal/terminal-lease.ts`, `desktop-terminals-port.ts:31,51` | Controllers hold leases under their own holder id; a live lease of another holder is refused even when it yields, so A cannot take over what B's window used in the last minute. Terminal requester/`writableByMe` mapping knows only `phone:`. Controller terminal leases are dropped only by TTL. |
| Scopes | `auth-service.ts:97`, `shared/environment/auth.ts:26` | Controllers and phones both hold every scope, including `node:admin`. |
| Catalog | `rpc-dispatch.ts:483` | `RpcHostHooks.listHarnessModels` is synchronous and its result is not awaited; desktop model lists are async (Codex app-server, Claude probe). `harness.resources` is a CLI-only extension. |
| Git | runtime `workspace/git-service.ts` vs `git/worktree-ops.ts` | Runtime reads use `execFileSync` without timeout (blocks B's main thread). Desktop `activateWorktree` has a per-repo lock and collision suffix that parallel collaboration starts need. |
| Config families | `apps/cli/src/rpc/{resource,codex,session-provider,automation,mcp-apps,artifact}-handlers.ts` | CLI-only. Desktop keeps duplicates (`mcp-config-service.ts`, `skills-service.ts`, `codex-config-service.ts`) or different stores (`providers/credential-store.ts`, `db-automations.ts`). Phone `mcp.list` has a different shape from the controller's `mcp.list`. |
| A's UI | `remote-terminal-controller.ts`, `environment-host.ts:1878` | A lists only terminals it created and polls `terminal.read`; A recognizes only `control_released`, with no "used on B / take over" state. B shows A's lease as an anonymous external holder. |

## Steps

### 1. One client context and composer reads

- The node listener serves controllers from the client context (renamed from
  `phoneContext()`), with the same workspace, Git and extensions;
  `rpcContext()` is deleted. Until their steps, `controllerContext()` still
  differs in `sessions` (controllers keep `DesktopSessionHost`, step 2) and
  leaves out terminals and drafts, whose leases map every non-phone requester
  to the window (steps 3–4).
- One desktop Git port for every client: runtime `WorkspaceGitService`, with
  desktop's `activateWorktree` (per-repo lock, collision suffix) and async
  `fetch`.
- Catalog methods of the node contract, `harness.resources` and
  `provider.listModels`, answered from the same probes B's window uses:
  `CONNECT_CLAUDE` and the local branch of `CODEX_LIST_MODELS` move out of
  `apps/desktop/src/main/index.ts` into a shared module.
- `ProvidersPort.servedMethods`; a partial providers port over
  `credential-store.ts` serving the masked reads (credentials, platforms,
  bindings).
- Acceptance: A's composer on B shows models, efforts, API providers, Git
  status, branches, worktrees, `@` file and Git mentions and the file tree.

### 1b. Async Git reads

- `WorkspaceGitService` reads run `execFileSync` without a timeout, which
  blocks B's main thread. Make the port's reads async with a timeout (runtime,
  CLI and dispatcher handlers together).

### 2. One session host

- `LocalSessionHost` serves controllers too. The controller-only pieces of
  `DesktopSessionHost` move into it, keyed by the session's controller record
  or a per-context flag (never by payload): controller record on create, B's
  active session kept, Host Actions, release/admit, `restoreControl`, launch
  settings on resume, collaboration task label. `DesktopSessionHost` is deleted.
- Fork, setCwd, tags, UI flags, close, remove, modUi become served for
  controllers. `forkHarnessResume` stub removed if unused.

### 3. Leases and takeover

- A lease that yields can be taken over by another holder; controller-supplied
  `yields`/`delegate` are normalized by the server. Controller leases are
  revoked with its client session (revoke, suspend).
- B labels A's leases from `auth.listClientSessions()`; A shows "<B> is using
  this session" with Take over, symmetric with B's banner.

### 4. Terminals

- Terminal requester and `writableByMe` mapping cover controllers
  (`node:<clientSessionId>`); terminals join the controller context.
- A adopts B's terminals through `terminal.list` and the pushed
  `terminal`/`terminalList` topics instead of polling.

### 5. Configuration families

- Move the desktop duplicates (Claude/Codex MCP config, skills) onto the
  runtime implementations, then serve `mcp.*`, `skills.*`, `hooks.*`,
  `agents.*`, `plugins.*` (desktop shell-path wrapper, live-session plugin
  reload) from shared handlers moved out of `apps/cli`. Resolve the phone
  `mcp.list` name clash.
- `sessionProviders.*` over `createSessionProviderStore(getDb())` with a
  window refresh; `settings.get` projected from B's app settings.
- `codex.*` adapter over `codex-experiment-service`/`codex-plugins-service`
  (device-code login); `automation.*` adapter over `db-automations`;
  `mcpApps.*` from the session host; artifact zone moved to runtime with a
  sync root under `node-host`.
- Provider writes over `credential-store.ts`. `provider.getCredentialDecrypted`
  and `provider.exportBundle` stay unserved; MCP env and headers are masked.
  Phone and controller get the same answer.
- Controller writes notify B's window the same way its IPC does.

### 6. Git writes and harness management

- Serve `switchBranch`, branch create, `worktreeAssignBranch`, handoff,
  `worktreeRemove` through desktop's git ops; `harness.enable/disable` and
  `sandbox.probe` through desktop hooks.

### 7. Docs, tests, acceptance

- Flip `node-host-server.integration.test.ts` privacy assertions (`:135`,
  `:162-164`, `:189-191`, `:280-290`); add paired-controller coverage per step.
- Update the long-term docs above and the comments that state the old policy
  (`desktop-session-host.ts:117`, `desktop-domain.ts:51,98,193,198`,
  `session-event-recorder.ts:7`, `node-host-server.ts:102`).
- Lab acceptance: `bun run dev:cdp` (A) + `bun run dev:desktop-node:lab` (B),
  both from this worktree.
- Delete this plan when done.

## Progress

- 2026-10-14: Plan written from the investigation above.
- 2026-10-14: Step 1 code done (uncommitted). `harness/harness-catalog.ts`
  holds the window's `CONNECT_CLAUDE`/`CONNECT_CODEX`/`CODEX_LIST_MODELS`
  probes; `node-host/desktop-catalog-methods.ts` serves `harness.resources` and
  `provider.listModels` from it; `desktop-git-port.ts` replaces the worktree
  port for every client; `desktop-providers-port.ts` serves masked credential
  reads. Desktop extensions compose in `DesktopDomain`. Verified: desktop main,
  runtime and CLI typechecks; main `node-host`, `remote`, `environment`,
  `harness` tests 128 files / 1014 passed, including a paired-controller test
  for models, catalog, Git and the credential boundary. Not yet run: the
  two-instance lab.
