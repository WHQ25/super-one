# SuperOne Persistent Remote Node Service

The headless `superone` node: what it owns, how clients reach and trust it, how
it persists and recovers, how harness runtimes are owned on it, and how it is
installed and published. Section numbers are cited from code; keep them stable.

## 1. Decision Summary

SuperOne models each local or remote node runtime instance as an execution
environment: a persistent `superone` service instance, its fixed per-user data
directory, and the Unix principal it runs as. It is not a physical machine: one
Linux host may run several isolated environments for different Unix users, and
one Unix user owns one node environment per release channel (§8). A remote
environment owns:

- projects and workspace paths
- Sessions and provider runtimes
- terminals and child processes
- filesystem and Git operations
- MCP processes and tools
- provider configuration and credentials
- durable event and message state

The remote boundary sits above `SessionManager`. A desktop must not create a
local `Session` whose `SessionBackend` happens to run remotely, because that
would split Session ownership, permissions, lifecycle, and persistence across
two processes.

SSH is a bootstrap, repair, and optional tunneling mechanism. It is not the
application protocol and does not own the node lifecycle. Product traffic uses
the same authenticated RPC protocol whether the access endpoint is direct WSS,
Tailscale, an SSH local forward, or a relay.

The production deployment target is a Linux `systemd` user service. Closing
SuperOne, dropping the network, or closing an SSH tunnel must not stop the node
or its active Agent turns.

## 2. Goals

- Operate Linux projects from the SuperOne desktop as first-class projects.
- Keep active Agent turns running while every client is disconnected.
- Reconnect and reconstruct authoritative state without relying on an in-memory
  desktop transcript.
- Support more than one client and more than one access route to a node.
- Preserve the existing Session/Harness behavior and provider identities.
- **Reuse harness implementations across local and remote.** Node harnesses
  share the same Electron-free provider core as the desktop path (`@superone/claude`,
  `@superone/codex`, …) rather than a CLI-only side track (print mode, custom
  protocol parsers). Thin host adapters (permission UI, MCP registration, spawn)
  may differ; the agent protocol and turn semantics must not.
- Keep local execution working while the two paths converge.
- Reuse the same RPC contracts for desktop, mobile, and future web clients.
- Make remote access authenticated, revocable, observable, and upgradeable.
- Isolate environments on the same host by Unix principal and stable runtime
  identity, with one fixed node data directory per principal and channel.

## 3. Non-goals

- Treating SSHFS or a mounted network filesystem as remote execution.
- Sending individual shell commands over SSH as the normal Agent runtime.
- Automatically copying provider credentials from the desktop to a node.
- Reusing the mobile remote-control room protocol as the node protocol.
- Supporting arbitrary third-party node implementations.
- High availability or automatic failover between nodes.

## 4. Prior Art

The environment model follows T3Code: one server instance is one stable
environment whose identity is independent of hostname, address and endpoint; a
known environment is client-local metadata; launch method and access method are
separate; SSH only launches the server and forwards a port; pairing credentials
differ from steady-state sessions; and a connection supervisor owns retries.
SuperOne differs in two ways: the node is supervised by `systemd` and outlives
every client and tunnel, and the desktop keeps node credentials and sockets in
Electron Main behind typed IPC instead of letting the renderer connect directly.

## 5. Architecture

```mermaid
flowchart LR
    UI[Renderer UI] --> IPC[Typed preload IPC]
    IPC --> ER[Environment Registry]
    ER --> LG[Local Environment Gateway]
    ER --> RG[Remote Environment Gateway]
    LG --> LM[Local SessionManager]
    RG --> CS[Connection Supervisor]
    CS --> RPC[Authenticated RPC Session]
    RPC --> NODE[superone]
    NODE --> RM[Node SessionRuntime]
    NODE --> TM[Terminal Manager]
    NODE --> FS[Workspace FS and Git]
    NODE --> DB[(Node SQLite and event log)]
    RM --> H[Claude Codex Cursor OpenCode ACP-Grok]
```

### 5.1 Process boundaries

`superone` is a Node.js process with no Electron dependency. It hosts the domain
services that must run where the project lives. Electron-only functions
(windows, dialogs, desktop keychain, native menus, renderer event transport)
remain in `apps/desktop`. The renderer never holds node sockets or credentials.

```text
packages/shared      @superone/shared    wire contracts: environment, auth, RPC, events, harness catalog
packages/runtime     @superone/runtime   node server core, session runtime, lease, collaboration,
                                         fs, git, workspace, harness kernel, db schema, automations, drafts
packages/claude      @superone/claude    Claude Agent SDK turn core
packages/codex       @superone/codex     Codex App Server client
packages/acp         @superone/acp       ACP client (Grok)
packages/opencode    @superone/opencode  OpenCode server + SDK client
packages/cursor      @superone/cursor    Cursor SDK turn core
packages/deepseek    @superone/deepseek  in-process dsh runtime
apps/cli             @superone/cli       node entry, RPC handlers, host adapters, systemd, CLI
apps/desktop                             Electron shell, local gateway, remote client gateway
apps/relay                               mobile remote-control relay
```

Dependency rules:

- `@superone/runtime`, harness packages and `apps/cli` never import Electron.
  Protocol, auth-client, connection-supervisor and RPC-client cores are
  platform-neutral; Electron Main and mobile supply socket and secure-store
  adapters around them.
- Cross-harness infrastructure (session, git, fs) never lives in a harness
  package; harness packages depend on `@superone/shared` and their vendor SDK.
- Hosts (`apps/cli`, desktop main) depend on cores; cores never depend on hosts.
- One package per deployable concern; no single `@superone/core`.

`apps/cli` depends on every harness package; the published `@super-one/cli`
bundles all adapters, and only the vendor native runtimes are external (§15.4,
[runtime-delivery.md](../harness/runtime-delivery.md)).

Harness reuse rule: when a harness exists on desktop, the node runs the same
provider integration through the shared core, with host concerns in thin
adapters. Node Claude turns use `ClaudeLiveSession` from `@superone/claude`
(`apps/cli/src/session/claude-turn-runner.ts`); the desktop still drives the SDK
through its own `apps/desktop/src/main/agent/claude-query.ts` and imports only
helpers from the core. `apps/cli/src/session/claude-print-client.ts` (print-mode
stream-json) is a test reference, not a product path.

### 5.2 Gateway boundary

Desktop features route through an environment-scoped gateway
(`packages/shared/src/environment/`, `apps/desktop/src/main/environment/`):

```ts
interface EnvironmentGateway {
  getDescriptor(): Promise<ExecutionEnvironmentDescriptor>
  listProjects(): Promise<ProjectSnapshot[]>
  getProject(projectId: string): Promise<ProjectSnapshot>
  subscribeEvents(input: SubscribeEventsInput): AsyncIterable<EnvironmentEvent>
  sessions: SessionGateway
  interactions: InteractionGateway
  terminals: TerminalGateway
  workspace: WorkspaceGateway
}
```

The typed sub-gateways cover complete operation families: Session
create/send/interrupt/close, permission/question/plan response, terminal
attach/input/resize/kill, file watch cancellation, and transfer cancellation.
Features must not bypass the gateway with environment-specific raw IPC.

`RemoteEnvironmentGateway` delegates to an authenticated node RPC session.
`LocalEnvironmentGateway` delegates to in-process services; its Session port
wires only `list` today, and local Session create/send still use the agent IPC.

UI stores use scoped references and never route by a bare project or Session ID:

```ts
type EnvironmentRef = { environmentId: string }
type ProjectRef = { environmentId: string; projectId: string }
type SessionRef = { environmentId: string; sessionId: string }
type TerminalRef = { environmentId: string; terminalId: string }
```

## 6. Domain Model

### 6.1 ExecutionEnvironment

An `ExecutionEnvironment` is one node runtime instance with a stable random
`environmentId` persisted in `<node dir>/environment-id`. The local desktop
runtime is also an environment.

`ExecutionEnvironmentDescriptor` (`packages/shared/src/environment/descriptor.ts`)
carries `environmentId`, `label`, `platform { os, arch }`, `nodeVersion`,
`protocolVersion`, `capabilities`, and optionally `cliVersion`, `generations`,
`nodePublicKeyFingerprint` and `syncRoot`.

Capabilities are negotiated, not inferred from version strings.
`EnvironmentCapabilities` (`capabilities.ts`): `sessions`, `harnessIds`,
`terminal`, `workspaceFs`, `git`, `worktrees`, `mcp`, `fileTransfer`,
`collaboration`, `nodeAdmin`, `coldSessionResume`, `turnReattach`,
`hostActionV1`, `drafts`, `syncZone`. Unknown keys are dropped and missing flags
default to false (`normalizeCapabilities`).

The node persists an Ed25519 instance key (`secrets/instance.key`) and a binding
hash of hostname, Unix UID and node directory (`secrets/binding-hash`,
`packages/runtime/src/server/identity.ts`). A binding change puts the node in
`identity_conflict`: the server rejects clients with that code and the
supervisor blocks. Clients bind a known environment to both `environmentId` and
the key fingerprint, and block any endpoint that answers with a different
fingerprint. A copied node directory on another host trips the binding check.

Two isolated clones that never share a client cannot be detected, so backup/VM
restore instructions require `superone identity regenerate` before network
access. It creates a new `environmentId`, key pair, binding and pairing state
without rewriting project or Session data.

### 6.2 KnownEnvironment

A connection starts as a client-local pending profile, because a manually
entered WSS or SSH endpoint does not know its identity before the first
authenticated descriptor exchange:

```ts
interface PendingConnectionProfile {
  connectionId: string
  label: string
  endpointProfiles: EndpointProfile[]
}
```

After authentication it is atomically bound to a node identity and becomes a
`KnownEnvironment` (`known-environment.ts`) holding presentation and access
metadata, not authoritative state:

```ts
interface KnownEnvironment {
  connectionId: string
  environmentId: string
  nodePublicKeyFingerprint: string
  label: string
  endpointProfiles: EndpointProfile[]
  preferredEndpointId?: string
}
```

Binding deduplicates entries by verified identity. Every later endpoint change
or failover must return the same environment ID and fingerprint or the
connection is blocked.

Secrets are stored separately in a fail-closed platform credential store keyed
by `connectionId`, never in an ordinary SQLite row or renderer storage. The
desktop's plaintext-SQLite secret fallback is not acceptable for node
credentials; without secure storage the client keeps an explicitly temporary
in-memory session or refuses to save.

### 6.3 EndpointProfile

`EndpointKind`: `direct-wss`, `tailscale`, `ssh-forward`, `relay`, `local`.
Endpoint profiles describe access only; they never create a second environment
or duplicate its projects and Sessions. `relay` is not connectable
(`CONNECTABLE_ENDPOINT_KINDS` in `client-view.ts`; see §11.4).

### 6.4 InstallationProfile

`InstallationProfile`: `systemd-user`, `systemd-system`, `container`, `manual`,
`nohup`, `local-electron`. Only `systemd-user` has an installer
(`apps/cli/src/systemd/install.ts`). SuperOne records how it installed a node for
diagnostics and upgrades; the node stays usable if one client forgets that
profile.

## 7. Runtime Ownership

The node is authoritative for all state whose meaning depends on the remote
filesystem or process runtime:

| State | Authority |
|---|---|
| Node identity and capabilities | node |
| Remote projects and paths | node |
| Session metadata and transcript | node |
| Active turns and permission requests | node |
| Provider resume IDs and runtime payloads | node |
| Terminal processes and snapshots | node |
| Git status, branches, worktrees | node |
| MCP server lifecycle | node |
| UI layout, selected environment, endpoint preference | client |
| Cached remote snapshots | client, disposable |

Desktop caches accelerate rendering but are never the recovery source. A
reconnect hydrates from the node snapshot, then resumes its event cursor.

## 8. Node Persistence

The node directory is `<personal root>/node` (`resolveNodeHome` in
`apps/cli/src/config.ts`): `~/.superone/node` for stable and
`~/.superone/alpha/node` for alpha, where the personal root comes from
`SUPERONE_HOME` or the `SUPERONE_VARIANT` baked into the published bundle
(`packages/runtime/src/fs/superone-home.ts`). Stable and alpha nodes coexist per
user with separate directories, ports (7788 / 7790), systemd units
(`superone.service` / `superone-alpha.service`) and binaries
(`superone` / `superone-alpha`). SSH bootstrap, the systemd unit, diagnostics,
harness state and identity commands all resolve the same directory for a
channel.

`SUPERONE_NODE_HOME` is an internal override for automated tests and the dev
labs, not a production multi-instance feature. Real multi-instance support would
need its own identity, service-unit, port and upgrade design; a path flag alone
is insufficient.

```text
<node dir>/
  environment-id
  state.sqlite
  config.json            node agent settings
  secrets/               instance.key, provider-secrets.key, binding-hash
  logs/
  runtime.json
  sync/                  session sync zone
  codex-accounts/
```

Harness runtime binaries live in the shared harness root, not here
([runtime-delivery.md](../harness/runtime-delivery.md) §5).

The schema is in `packages/runtime/src/db/schema.ts` and `database.ts`: pairing
tokens, client sessions, refresh reuse log, WebSocket tickets, idempotency
receipts, `environment_events`, terminals, projects, sessions (metadata,
`transcript_json`, pending interaction, provider resume, controller, settings),
host actions, control leases, collaboration grants/messages/cursors, harness
installations, provider credentials/bindings, automations and session providers.
SQLite runs in WAL mode with foreign keys on. Secret material lives in
owner-only files, not ordinary rows.

Durability rules:

- The target invariant: a mutating command's idempotency receipt, aggregate
  state and durable events commit in one SQLite transaction or not at all, so a
  crash can never leave state without its event (which would break cursor
  recovery) or a mutation without its receipt. The code does not meet it yet:
  `SessionRuntime` writes the session row and calls `EventLog.appendSession` as
  separate statements, and `apps/cli/src/auth/idempotency.ts` runs the command
  under an in-memory in-flight lock and stores the receipt afterwards.
- Receipts are keyed `(client_identity, operation, idempotency_key)` and store a
  request-payload hash; reusing a key with a different payload returns
  `idempotency_conflict`.
- `SessionRuntime` projects every turn into the durable log
  (`SESSION_DURABLE_EVENT` in `packages/shared/src/environment/session-events.ts`):
  user message, turn start/completion/interruption/error, assistant deltas and
  final blocks, tool start/input/result, permission/question/plan requests and
  responses, and status changes. The session row's `transcript_json` is the
  committed transcript. A disconnect loses no acknowledged semantic transition.
- Old events may be deleted only after a snapshot at or beyond their sequence
  is durable, and a cursor older than retained history receives `cursor_too_old`
  rather than a partial stream. `environment_events` is currently append-only
  and never pruned, so `cursor_too_old` (defined in `packages/shared/src/environment/rpc.ts`)
  is not emitted.

The desktop's in-memory `apps/desktop/src/main/session/event-seq.ts` process
epoch is not a durable cursor and is not used by this protocol.

## 9. Commands, Events, and Reconnect

### 9.1 RPC model

RPC uses schema-validated envelopes (`packages/shared/src/environment/rpc.ts`).
Mutating operations carry a client-generated idempotency key:

```ts
interface RpcCommandEnvelope<T> {
  protocolVersion: number
  requestId: string
  idempotencyKey?: string
  environmentId: string
  method: string
  payload: T
}
```

A retry with the same authenticated client and key returns the prior receipt
instead of repeating the mutation.

The descriptor advertises protocol and database-schema generations as
`{ current, min, max }` (`PROTOCOL_GENERATION`, `DATABASE_SCHEMA_GENERATION` in
`protocol.ts`); `negotiateHandshake` blocks the connection before mutable RPC
when the ranges do not overlap.

### 9.2 Event log

Every durable environment event has a stable `eventId`, a monotonically
increasing environment `sequence` (decimal string on the wire, SQLite integer
internally), timestamp, aggregate type and ID, event type and version, payload,
and optional causation request ID. There is one sequence per environment.

On connect:

1. Authenticate and verify the expected `environmentId`.
2. Negotiate protocol and capabilities.
3. Request a consistent snapshot and its `snapshotSequence`.
4. Subscribe from `snapshotSequence + 1`.
5. Detect gaps and resnapshot rather than silently continuing.

Client acknowledgement is a delivery cursor, not a shared `read` flag.

### 9.3 Recovery guarantees

| Failure | Agent turn | PTY | Pending interaction | Recovery result |
|---|---|---|---|---|
| Client/network/SSH tunnel disconnect | continues | continues | remains pending | reconnect snapshot plus cursor resumes the same live runtime |
| Graceful node restart or upgrade | interrupted | closes | persisted | Session remains usable; later turns resume from provider metadata (`coldSessionResume`) |
| Node or systemd crash | dies with the node cgroup | dies | persisted | startup reconciliation marks running work interrupted, keeps committed output, permits a later turn from durable resume state |
| Provider subprocess crash | current turn ends in error/interrupted | unaffected | reconciled | provider restarts for a later turn |

The node advertises `coldSessionResume: true` and `turnReattach: false`; no
harness reattaches an in-flight turn across a node restart.

A disconnected client never causes permission escalation: a turn needing
approval waits for an authorized client or follows an explicit node-side timeout
that records a denial. Idle provider processes are released by the runtime
reaper while their resume metadata stays durable.

### 9.4 Fenced control leases

Interactive Session and writable terminal control use server-issued leases
(`packages/shared/src/environment/lease.ts`, `packages/runtime/src/lease/control-lease.ts`):

```ts
interface ControlLease {
  leaseId: string
  resource: SessionRef | TerminalRef
  holderClientId: string
  generation: string
  expiresAt: string
}
```

- One live control lease per resource; observers never acquire one and never
  block the holder.
- The holder renews before expiry. Disconnect does not transfer control
  instantly; the short TTL bounds takeover delay. Explicit release permits
  immediate acquisition.
- Every mutating control command carries `leaseId` and `generation`; the node
  rejects expired, superseded or late commands even if their socket survives an
  endpoint failover.
- Permission, question and plan responses require scope plus the current
  Session lease.
- The lease epoch is random per node process, so a restart invalidates every
  prior lease; clients reacquire after synchronization.

## 10. Connection Supervision

Electron Main owns one supervisor per desired environment, built on the
platform-neutral `ConnectionSupervisorCore`
(`packages/shared/src/environment/connection-supervisor-core.ts`):

```text
available -> connecting -> synchronizing -> connected
                    |             |
                    v             v
                 backoff <----- disconnected
                    |
                 blocked            (plus offline)
```

Transient failures retry with capped exponential backoff and jitter. `auth`,
`protocol_incompatible`, `revoked`, `invalid_config`, `identity_conflict` and
`user` enter `blocked` and require user action. Resume and network-online events
trigger an immediate probe.

Endpoint selection follows saved preference, then observed successful routes.
Failover to another endpoint (`endpoint-failover.ts`) proceeds only after the
resolved descriptor carries the same `environmentId` and key fingerprint.

## 11. Access Methods

### 11.1 SSH bootstrap and forward

Desktop uses the system OpenSSH client to inherit `~/.ssh/config`, ssh-agent,
ProxyJump, host key verification and platform security updates
(`apps/desktop/src/main/environment/ssh-tunnel-manager.ts`, `ssh-forward.ts`,
`remote-install.ts`). SSH is used for host probe, preflight, node install or
upload, systemd install and status, one-time pairing-token creation, log
retrieval and `-L localPort:127.0.0.1:nodePort` forwarding.

The node binds loopback (`127.0.0.1`) by default. Closing the forward
disconnects this desktop but never stops the service. Passwords stay in memory
only; key and agent auth are preferred; host key errors are never auto-accepted.

### 11.2 Tailscale

Tailscale is the preferred direct route for personal deployments. Tailscale
identity supplements but never replaces SuperOne application auth. A `tailscale`
endpoint is an HTTP(S) base URL probed at `/health`; the desktop can suggest a
host from `tailscale status --json` (`endpoint-probes.ts`) but never uses its own
Tailscale self IP or its local `tailscaleServeEnabled` state for a remote node.
Each node is responsible for its own Tailscale endpoint.

### 11.3 Direct WSS

An operator may expose the node behind a TLS reverse proxy. Plain public
`ws://` is rejected, and forwarded headers are not trusted by default.

### 11.4 Relay

The environment relay is a separate protocol from mobile remote control: node
and clients connect outbound to a broker that forwards opaque end-to-end
encrypted frames and never holds provider credentials or plaintext workspace
data. It must support node/client roles, multiple clients, per-client identity,
flow control, replay bounds and connection generation. Relay-visible metadata is
limited to routing identifiers, connection generation, opaque frame size,
flow-control counters and expiry; method names, resource IDs, prompts, terminal
output and file data stay inside the encrypted payload. Relay replay is a
transport optimization; the node's event log remains the recovery authority.

Only the framing contract exists (`packages/shared/src/environment/relay-framing.ts`);
`apps/relay` serves mobile remote control ([relay-crypto.md](relay-crypto.md)).

## 12. Authentication and Authorization

### 12.1 Pairing

1. An administrator creates a single-use pairing token on the node
   (`superone pair-create`), normally through SSH bootstrap.
2. The client generates a device key pair and exchanges the token while
   registering its public key and presentation metadata.
3. The node creates a revocable client session and returns a rotating refresh
   credential bound to the device key.
4. Refresh produces a scoped access token. Refresh requires a device proof over
   `refresh:<clientSessionId>:<unixMs>` within a 120 s window; credentials rotate
   on use, and reuse outside a 60 s grace revokes the session.
5. A WebSocket upgrade on `/ws` consumes a single-use ticket bound to the
   client session, scopes and device-key thumbprint.

Lifetimes are `AUTH_CREDENTIAL_LIFETIMES` in `packages/shared/src/environment/auth.ts`:

| Credential | Lifetime | Stored by node | Terminal transitions |
|---|---|---|---|
| pairing token | 10 minutes, one exchange | keyed hash, scopes, issuer, expiry | consumed, expired, revoked |
| client refresh family | 90 days since last use, rotates | keyed hash, device public key, scopes | rotated, reuse-revoked, admin-revoked, expired |
| access token | 15 minutes | session/revocation metadata only | expired or session-revoked |
| WebSocket ticket | 30 seconds, one `/ws` upgrade | keyed hash, proof thumbprint | consumed, expired, session-revoked |

Pairing tokens and tickets are consumed atomically; consumption and rotation use
compare-and-update so concurrent attempts have one winner. The node stores only
keyed hashes. Access tokens are signed by the node instance key and validated
for issuer, audience (`superone`), expiry, scope, session status and proof key.

Revoking a client session invalidates its refresh family, access tokens and
unused tickets and closes its sockets; scope changes force reconnect.
Proof-of-possession is required on every remote path so a forwarding layer
cannot replay a stolen bearer credential.

Pairing material is redacted from logs, errors, argv, shell history, SSH
diagnostics and support bundles. The SSH flow parses credentials in memory and
never embeds them in a saved command. The endpoint profile needed to rebuild a
tunnel is stored with the known environment; the credential is not.

### 12.2 Scopes

`AUTH_SCOPES`: `environment:read`, `project:read`, `project:manage`,
`session:read`, `session:operate`, `terminal:operate`, `workspace:read`,
`workspace:write`, `access:manage`, `node:admin`.

Administrative pairing grants all scopes. Later pairing flows may issue
read-only or task-limited clients without changing RPC contracts.

### 12.3 Session control

Authenticated client identity propagates to Session operations:

- observation does not imply control
- one client holds the interactive control lease for a Session (§9.4)
- background host work is a distinct trusted origin
- an Agent collaboration credential is never a node client credential

Each node Session records a controller (`controller_client_session_id`, the
pairing-level client session). Permission responses require `session:operate`,
a matching pending interaction and the current lease; they cannot be fabricated
by supplying another Session ID.

GUI-bound tools of a node Session (browser, computer use, device control) run on
the controlling desktop through the Host Action channel: a durable node-side
queue (`host_actions`) that the controller polls, claims and answers
(`session.hostActionsPoll` / `claimHostAction` / `renewHostActionClaim` /
`respondHostAction`,
`apps/desktop/src/main/environment/remote-host-action-consumer.ts`), exposed to
the node agent through a loopback MCP server
(`apps/cli/src/session/host-action-mcp-server.ts`). How files those tools
produce are shared between desktop and node is
[session-sync-zone.md](session-sync-zone.md).

### 12.4 Provider credentials

Provider authentication belongs to the execution environment. A node uses its
own Claude, Codex, Cursor, OpenCode and Grok configuration; desktop credentials
are never copied implicitly. Provider API secrets are encrypted at rest with
`secrets/provider-secrets.key` (`apps/cli/src/provider/`).

Codex login runs node-side, either through its CLI/device flow or an RPC that
returns an external-browser authorization URL; the desktop opens the URL, never
the node. An API-key form holds the secret briefly in renderer memory, never
persists or redisplays it, clears it after submission, and sends it through a
dedicated typed IPC path to Electron Main and then the node. Export/import of
provider configuration is a separate feature requiring explicit authorization.

## 13. Session and Harness Runtime

Remote support is an execution location, not another harness. The node catalog
(`NODE_HARNESS_DEFINITIONS` in `packages/shared/src/environment/harness-installation.ts`):

| Catalog ID | Session `HarnessId` | Runtime | Runtime source | Node turn runner |
|---|---|---|---|---|
| `claude` | `claude` | Claude Agent SDK + platform binary | `managed` | `@superone/claude` |
| `codex` | `codex` | Codex App Server platform package | `managed` | App Server over stdio |
| `cursor` | `cursor` | `@cursor/sdk`, in-process | `managed` (ships with the CLI) | `@superone/cursor` |
| `dsh` | `dsh` | `@deepseek-ai/dsh-*`, in-process | `managed` (ships with the CLI) | none |
| `opencode` | `opencode` | native OpenCode server + SDK client | `external` | `@superone/opencode` |
| `acp-grok` | `acp` | ACP client to Grok Build | `external` | `@superone/acp` |

Production turns go through `createProductionTurnRunner`
(`apps/cli/src/session/codex-turn-runner.ts`); a harness without a runner fails
closed. `simulatedHarness` is an in-memory readiness overlay for tests
(`apps/cli/src/runtime.ts`) and is never persisted.

`opencode` is an independent harness, never an ACP agent or an
`acpAgentId: opencode` shortcut. `acp-grok` is the concrete Grok catalog
identity; sessions, `capabilities.harnessIds` and the desktop `HarnessId` still
use the legacy wire id `acp` (`normalizeSessionHarnessId` in `packages/runtime/src/server/rpc-dispatch.ts`,
`HarnessManager.isSessionHarnessRunnable`). A migration to `acp-grok` must not
rewrite an arbitrary custom ACP profile to Grok without evidence that it uses
the Grok definition.

### 13.1 Runtime boundary

The node runtime (`packages/runtime/src/session/`, `apps/cli/src/session/`)
includes:

- `SessionRuntime` with SQLite persistence, control leases, queueing, idle reaper
- harness catalog, turn runners and provider runtime adapters
- permission, plan and question interactions
- collaboration grants and mailbox delivery (`packages/runtime/src/collaboration/`)
- skills and MCP resource RPC (`skills.*`, `mcp.*` in `apps/cli/src/rpc/resource-handlers.ts`);
  Claude turns merge project/user MCP config with the Host Action MCP server
- automations and drafts
- persistence ports and event publication

Electron callbacks become injected ports: renderer delivery becomes an event
publisher, desktop dialogs become durable interactions answered through RPC.

RPC dispatch for the shared method families (`environment`, `settings`,
`harness`, `project`, `fs`/`workspace`, `git`, `terminal`, `session`,
`collaboration`, `provider`) lives in `packages/runtime/src/server/rpc-dispatch.ts`
and runs against optional host ports (`rpc-context.ts`; `session.*` goes through
`SessionHostPort`). A host serves the families whose ports it provides, the
descriptor capabilities advertise exactly those, and any other family answers
`not_found` with `details.unsupported: true`. Host-only families (the CLI's
archive, MCP Apps, resources, automations, drafts, artifacts, Codex admin) plug
in through `RpcContext.extensions`.

Agent collaboration stays within one environment: parent and child Sessions run
on the same node and use its persistent mailbox. Cross-environment collaboration
is a separate protocol.

Recovery guarantees are advertised per environment (`coldSessionResume`,
`turnReattach`, §9.3). Parity means equivalent supported behavior, not identical
recovery guarantees for every harness.

### 13.2 Harness installation ownership

Adapters and protocol clients are part of the node. Runtime installation
ownership is narrower:

- SuperOne downloads only the Claude and Codex native runtimes.
- Cursor and dsh runtimes ship inside the CLI package.
- Users install and upgrade the `opencode` and `grok` executables.
- Detecting an external executable never grants permission to install, upgrade
  or delete it.
- ACP being a protocol does not make its agent executable dependency-free; one
  ACP adapter is reused while the concrete command stays user-managed.

Managed runtimes are fetched from R2 with npm fallback, verified against the
pin's SHA-256, unpacked into an immutable version directory and activated
atomically; SuperOne never mutates a globally installed CLI or runs an unpinned
global `npm install`. The mechanism is shared with the desktop:
[runtime-delivery.md](../harness/runtime-delivery.md).

For external harnesses, SuperOne resolves the configured command to an absolute
path, probes it, and persists the resolved configuration; a later probe detects
a path that disappeared or became incompatible.

### 13.3 Managed Harness release coupling

Managed runtimes follow the CLI release. They have no independent product
upgrade channel, and their upstream versions need not equal the CLI version.

- Each CLI release pins its managed runtime versions in source
  (`OFFICIAL_CLAUDE_SDK_VERSION`, `OFFICIAL_CODEX_NPM_VERSION` in
  `packages/runtime/src/harness/managed-official.ts`); `apps/cli/scripts/build-dist.ts`
  injects the release version used for pin lookup.
- `harness enable claude|codex` installs the pin of the running CLI. It never
  resolves an upstream `latest`.
- Offline installs use a `release-manifest.json` (or `SUPERONE_HARNESS_MANIFEST`)
  pin and land under `<harness root>/releases/<cliVersion>/harnesses/<id>/`
  (`managed-release.ts`).
- External harnesses are never upgraded by the CLI, only re-probed.

Decided but not yet implemented on the node (the desktop does the equivalent
with its update pre-fetch and startup alignment gate, runtime-delivery.md §7):
upgrading the CLI moves every enabled managed harness to the new CLI's pins
without downloading disabled ones, and CLI and managed-runtime activation
succeed or roll back together, so an old CLI is never left paired with a newer,
unverified runtime.

### 13.4 Harness state and advertised capabilities

Installation, administrator intent, authentication and readiness are separate
facts:

```text
disabled -> missing -> installing -> needs_auth -> ready
                            |              |
                            v              v
                          error       incompatible
```

Transitions may skip states; an installed external binary can move from
`disabled` to `ready` after one probe.

`capabilities.harnessIds` lists only enabled and `ready` harnesses
(`readySessionHarnessIds`); the production default is empty. The administrative
catalog (`harness.list` / `harness.show`, `node:admin`) exposes
`HarnessInstallationStatus`: `id`, `runtimeSource`, `enabled`, `state`,
`runtimeVersion`, `command`, `requiresAuth`, redacted `diagnostic`.

Secrets, raw environment values, tokens and passwords never appear in the
descriptor, CLI JSON output, logs or diagnostics.

### 13.5 Harness CLI surface

`superone harness` (`apps/cli/src/session/harness-cli.ts`; `superone harness --help`
is the reference) operates on the channel's node directory and harness root; all
subcommands accept `--json`:

```bash
superone harness list | show <ID>
superone harness enable claude|codex [--artifact <FILE>]
superone harness enable cursor
superone harness enable opencode [--command <ABSOLUTE_PATH> | --server-url <URL>]
superone harness enable acp-grok [--command <ABSOLUTE_PATH>] [--arg <VALUE>]...
superone harness configure opencode|acp-grok ...   # acp-grok also --default-args
superone harness disable <ID> [--drain wait|cancel] [--timeout <DURATION>]
superone harness doctor [<ID>] | probe <ID>
superone harness repair claude|codex --artifact <FILE>
```

- `enable claude|codex` without `--artifact` reuses a runtime already on the
  host, else downloads the CLI pin (§13.3). `--artifact` is the offline path and
  must match the manifest pin's platform, architecture and digest.
- A runtime that installs but lacks provider auth is enabled with state
  `needs_auth` and is not advertised until a readiness probe succeeds.
- `enable acp-grok` defaults to `grok agent stdio`; any `--arg` replaces the
  whole default argument list. OpenCode may take `--command` or `--server-url`
  (accepted only under the node's transport-security policy).
- `configure` is transactional: the proposed configuration is probed before it
  replaces the working one. `claude` and `codex` have no `configure`.
- `disable` defaults to `--drain wait --timeout 60s`; timeout fails rather than
  killing a provider. It never deletes a managed artifact or a user-owned
  executable.
- `--env-file`, `--server-password-stdin`, `--clear-server-password`,
  `--clear-env`, `--startup-timeout` and `--initialize-timeout` are reserved and
  rejected if passed.
- There is intentionally no `harness install`, `upgrade`, `remove`, `login` or
  `add`: `enable` installs, CLI upgrade owns managed updates, provider login
  belongs to each harness integration, and third-party harness installation is
  out of scope. Models, effort, permission presets and API providers belong to
  provider or Session configuration.

### 13.6 Persistence and security requirements

Non-secret harness intent and diagnostics persist in node SQLite
(`harness_installations`). Secret environment values and server passwords belong
in the node secret store with owner-only permissions. Managed artifacts become
executable only after verification and are never selected by an untrusted
filename, unresolved environment variable or mutable upstream tag.

Harness mutations require `node:admin`. Read-only catalog status also requires
`node:admin` until a dedicated read scope exists; ordinary Session clients cannot
enable, reconfigure, repair or disable a harness. Every mutation must record the
authenticated client, previous and new state, artifact identity or executable
fingerprint, and result, without secrets.

After a successful configuration change the node reloads harness availability
for new Sessions. Existing Sessions keep their bound runtime until drain,
disable or release; a change never silently swaps the executable under an
active Session.

## 14. Terminal, Filesystem, and Git

### 14.1 Terminal

PTYs are created on the node. Terminal references are environment-scoped with
authenticated ownership; output events carry a monotonic sequence, and the node
keeps a bounded snapshot so a reconnect does not replay unlimited output.

### 14.2 Filesystem

Remote paths are opaque node paths. Desktop code never calls `existsSync`,
`realpath` or file watchers on them. Workspace RPC provides stat, list, read,
atomic write, search and watch, with a 10 MiB per-file cap on read/write.

The node enforces allowed project roots, normalizes real paths, rejects
traversal and symlink escapes, and applies payload and transfer limits.

### 14.3 Git and worktrees

Git commands and worktree creation execute on the node. A local and a remote
clone are distinct projects even when repository identity groups them in the UI.
Worktree paths never cross environments.

### 14.4 Session artifacts

Each Session has a sync zone mirrored between the controlling desktop and the
node (`<node dir>/sync/<sessionId>/`) so Host Action outputs and agent-written
files are readable on both sides; see [session-sync-zone.md](session-sync-zone.md).

## 15. Installation, Service Lifecycle, and Upgrade

The Linux installation provides:

- versioned `superone` artifacts with checksum verification
- atomic version switch on upload installs (`versions/<stage>` + `current` symlink)
- a `systemd` user unit (`apps/cli/src/systemd/unit.ts`)
- linger detection
- explicit Unix-account binding, data and log paths
- preflight checks for runtime and native dependencies
- `start`, `status`, `version`, `install-systemd`, `uninstall-systemd`,
  `systemd-status`

### 15.1 Public packages and binary name

Runtime packages publish to the public npm organization `super-one`
(`PUBLIC_CLI_PACKAGE`, `PUBLIC_CLI_BIN` in `packages/shared/src/environment/publish.ts`
and `apps/cli/scripts/pack-npm.ts`).

| Role | Name |
|---|---|
| Headless node CLI | `@super-one/cli` (public) |
| Monorepo workspace | `@superone/cli` (private) |
| Global binary | `superone` (`superone-alpha` for alpha installs by the desktop) |

Only the CLI is published; workspace packages such as `@superone/shared` are
bundled into it. User-facing docs, install commands and desktop remote install
always use the public names.

```bash
npm install -g @super-one/cli
superone start
superone pair-create
```

Publish policy:

- the package is public (`--access public`)
- the CLI uses semver in lockstep with the desktop version
- the desktop pins an exact CLI version when installing remotely and never
  installs a bare `latest` or channel tag (§15.4)
- the CLI never imports Electron

### 15.2 Dual install paths (registry default, upload for dev)

SSH is only a bootstrap channel. Getting `superone` onto a host has two paths
(`apps/desktop/src/main/environment/remote-install.ts`, `DEFAULT_REMOTE_INSTALL_SOURCE = 'registry'`):

| Path | When | Mechanism |
|---|---|---|
| `registry` (default) | Product Settings UI | Over SSH, `npm install -g --prefix <remote root>/npm @super-one/cli@<exact>` without root, linked into `~/.local/bin/<superone\|superone-alpha>` |
| `upload` (dev/debug) | Local builds, unreleased commits, offline hosts | Desktop uploads `superone-<version>-<target>.tar.gz`, verifies SHA-256 remotely, extracts to `<remote root>/versions/<stage>` and switches `current` with `ln -sfn` in one SSH session |

Rules:

1. Discovery looks only at the channel's own install paths
   (`<remote root>/npm/bin/superone`, `<remote root>/current/bin/superone`,
   `~/.local/bin/<bin>`). An install at the desktop's version is reused; an older
   or unreadable one is upgraded; a newer one asks the user to update the desktop
   (`decideRemoteCliAction` in `packages/shared/src/environment/cli-version.ts`).
2. Registry is the product default; the destination field alone suffices when
   SSH key auth works. Advanced options pin a version or force upload.
3. Upload is opt-in and needs a matching local artifact
   (`apps/desktop/src/main/environment/dist-locator.ts`: `apps/cli/dist/` in dev,
   `resources/superone-dist/` when packaged).
4. Both paths share the post-install bootstrap: start the node on loopback, mint
   a pairing token in memory, open the local forward, pair.
5. Preflight requires Node ≥ 20 (`MIN_REMOTE_NODE_MAJOR`), npm for the registry
   path, and a supported target for upload; a missing systemd is a warning.

### 15.3 Distribution artifact (upload path and runtime bundle)

`apps/cli/scripts/build-dist.ts` produces a per-OS/arch tarball (`linux`,
`linuxmusl`, `darwin` × `x64`, `arm64`) with the JS bundle, native
`better-sqlite3` and `node-pty` beside it, a launcher, a `.sha256` sidecar and
`MANIFEST.json`. `--with-node` embeds a Node runtime (`bundlesNodeRuntime`);
otherwise the launcher uses `node` on PATH and checks major ≥ 20. The npm
package likewise relies on host Node ≥ 20.

The target for clean hosts is a complete artifact with an embedded runtime that
does not depend on the host's Node.js, covered by checksum and signature.

### 15.4 Release channels, npm dist-tags, and CI publish

SuperOne ships two channels, alpha and stable (`apps/desktop/variants.json`
also has `dev`, which never publishes). npm expresses channels with semver
pre-release identifiers and dist-tags; it has no pointer files like the desktop
updater.

| Channel | Example version | npm dist-tag | Default `npm i -g @super-one/cli` |
|---|---|---|---|
| alpha | `0.49.4-alpha.3` | `alpha` | no |
| stable | `0.49.4` | `latest` | yes |

Publish rules:

1. Never publish a pre-release with dist-tag `latest`; `pack-npm.ts`
   (`assertSafePublishVersion`) refuses it.
2. Pre-releases use an explicit tag (`--tag alpha`).
3. Publish the exact version of the matching desktop release (lockstep) so
   protocol and schema compatibility is obvious.
4. npm does not cascade tags: a stable publish moves `latest` only.
5. The published bundle bakes `SUPERONE_VARIANT` from the version, so an alpha
   CLI uses the alpha node directory, port and unit name (§8).

Desktop remote install pins an exact CLI version from the running app version
(or an explicit override; `resolveRegistryVersion` in `environment-host.ts`):

```text
Desktop app version 0.49.4-alpha.3
  → remote: npm install -g --prefix <remote root>/npm @super-one/cli@0.49.4-alpha.3
```

So each desktop release offering registry install needs the same version on npm,
or the user must use upload. Alpha desktops never default to a stable CLI or the
reverse.

Operators:

```bash
npm install -g @super-one/cli                  # stable (latest)
npm install -g @super-one/cli@alpha            # alpha tip
npm install -g @super-one/cli@0.49.4-alpha.3   # pin (preferred for automation)
```

CI publish is `.github/workflows/publish-cli.yml` (`workflow_dispatch` and
`workflow_call`; inputs `version`, `tag`, `dry_run`, `ref`), never on every PR or
merge. It runs `bun install --frozen-lockfile` → resolve version and tag (empty
tag derives from the version) → `bun run test:cli` → `pack:npm` → smoke
(`npm install --omit=dev`, check usage, run `identity`) → optional
`npm pack --dry-run` → `npm publish --access public --tag <tag>` with `NPM_TOKEN`
or npm Trusted Publishing (`id-token: write`, `--provenance`). npm rejects
re-publishing an existing version. The desktop release skill dispatches it at
the same version as the desktop build. Desktop artifact channels (R2) and npm
dist-tags are aligned by convention; neither system moves the other's pointer.

`pack-npm.ts` esbuild-bundles monorepo sources with no `workspace:*`
dependencies. Externals: `better-sqlite3`, `node-pty`,
`@anthropic-ai/claude-agent-sdk` and `@cursor/sdk` with their platform packages,
pinned exactly from `packages/claude` and `packages/cursor`.

Local:

```bash
bun run pack:cli                               # → apps/cli/dist/npm
bun run pack:cli -- --version 0.49.5-alpha.1 --dry-run
bun run publish:cli -- --tag alpha             # requires npm auth
```

### 15.5 Service lifecycle

A `systemd-user` installation counts as persistent only with user lingering.
`install-systemd` checks `loginctl show-user <user> -p Linger`; without linger
it refuses to write the unit and exits with code 2 rather than claim
persistence. Enabling linger or installing a system service is an explicit
administrator action.

A node is bound to one Unix account: workspace access, Git/SSH configuration,
provider CLIs and credentials, and `HOME` belong to that principal. A future
system service must configure allowed roots, ownership, `HOME` and provider
credentials explicitly and never borrow another user's `HOME`.

The unit sets `WorkingDirectory`, `HOME`, `SUPERONE_HOME`, `SUPERONE_NODE_HOME`,
`UMask=0077`, `KillMode=control-group`, `TimeoutStopSec=30`, `Restart=on-failure`
with `RestartSec=3` and a start limit, `MemoryMax=2G` and `TasksMax=4096`, and
runs `superone start --foreground`. A controlled stop therefore takes provider
and PTY children with it rather than orphaning them. Journal output follows the
same redaction policy as application logs.

Upgrades are initiated by an authorized user. Today the desktop's
`upgradeRemoteNode()` (`environment-host.ts`) probes, preflights, disconnects,
reinstalls the pinned version from the registry, restarts the node and
reconnects. The target upgrade model:

- Release trust is rooted in public keys embedded in the installer and node
  launcher. A signed manifest binds version, protocol/schema compatibility,
  artifact digest, OS, architecture and signing-key ID; key rotation requires a
  manifest signed by an already trusted key.
- An external launcher verifies the new version, checks the
  protocol/schema compatibility matrix, takes a verified SQLite backup, applies
  a drain policy (`wait`, `cancel`, `force`, each with a timeout), switches
  atomically, and health-checks the new node. Startup or migration failure
  restores the previous binary and, when needed, the backup, without relying on
  the failed node to report itself. Irreversible migrations block binary
  rollback unless the backup is restored.
- Compatibility is defined by protocol and schema generations, not desktop
  release numbers.

Uninstall is destructive and separate from disconnect. Disconnecting removes or
disables a client connection only. `uninstall-systemd` disables and removes the
unit and never deletes node data.

## 16. Observability

Structured logs and traces include environment ID, connection ID, Session ID,
request ID, event sequence, endpoint kind and connection generation. By default
they never include pairing credentials, bearer tokens, provider keys, prompt
content, terminal output or file contents.

Node diagnostics expose service and protocol version, uptime and restart reason,
database health and migration version, active/idle Session and terminal counts,
endpoint state, bounded recent errors, and provider availability without
secrets.

## 17. Principal Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Split local and remote authorities | Remote boundary above `SessionManager` |
| Desktop path APIs touch remote paths | Environment-scoped workspace gateway |
| Active turns disappear on disconnect | Node-owned runtime plus durable events |
| Duplicate mutations after retry | Client idempotency keys and durable receipts |
| Public remote-code-execution surface | Loopback default, application auth, scopes, revocation |
| Relay semantics contaminate mobile control | Separate environment relay protocol |
| Provider secrets leak to clients | Node-local provider auth and redacted diagnostics |
| Upgrade strands an incompatible node | Generation negotiation, compatibility window, rollback |
| Extraction becomes a broad rewrite | Vertical slices and a preserved local gateway |

## 18. Confirmed Architecture Decisions

1. The first supported node OS is Linux with systemd.
2. The first managed service mode is `systemd-user`.
3. The first access path is SSH loopback forwarding.
4. Tailscale is the first non-SSH endpoint provider.
5. Electron Main owns credentials and node sockets.
6. The node owns authoritative Session and workspace state.
7. The first remote harness was Codex; Claude, Cursor, OpenCode and Grok follow
   through shared cores.
8. Provider credentials remain node-local.
9. The event stream uses one environment-wide sequence.
10. Relay and cross-environment Agent collaboration are separate protocols.
11. One Unix user owns one node environment per channel at `<personal root>/node`.
12. `SUPERONE_NODE_HOME` is an internal test and lab override, not a supported
    production multi-instance feature, and the public CLI does not expose a
    data-directory override.
13. SuperOne downloads runtimes only for Claude and Codex; OpenCode and Grok
    executables remain user-managed.
14. Managed runtimes are pinned by and upgraded with the CLI release; they have
    no independent upgrade channel.
15. The concrete Grok catalog ID is `acp-grok`. OpenCode is a distinct harness,
    not an ACP agent configuration.
