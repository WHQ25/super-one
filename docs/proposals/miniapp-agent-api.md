# Mini-app Agent API

Status: draft · Updated: 2026-10-01

Scope: let a mini-app drive agents, not just nudge the chat input. A mini-app
acts as a **delegate of an anchor session** and operates on that session's
collaboration graph — observe, launch, message, steer and report back — so a
developer can build agent-management apps (project manager, review pipeline,
multi-model compare) on top of SuperOne. Stateless model calls are out of scope
here; see [ai-gateway.md](ai-gateway.md).

## 1. Decisions

| Question | Decision |
|---|---|
| Unit a mini-app operates on | The collaboration graph of an **anchor session**: the anchor plus every session it spawned, linked or handed off, transitively. |
| Ownership model | No new one. The app acts on behalf of the anchor; launched sessions are ordinary collaboration children of the anchor. |
| Anchor resolution | Always explicit. No "first holder session" guessing. |
| Where the API lives | Node side, `context.agent` in the MiniApp Host. WebViews reach it through `superone.node`. |
| Harness specifics | None in the API. Events are a stable projection of `AgentEvent`; unsupported operations are reported through capability data. |
| Stateless LLM calls | Not part of this API. `context.ai` covers them. |

## 2. Current state

| Piece | Where | State |
|---|---|---|
| Agent API | `SuperOneMiniAppAgentApi` in `packages/shared/src/miniapp-host-api.d.ts` | `sendPrompt` (prefill only), `setContext`, `clearContext`, `onContextConsumed` |
| Execution | `apps/desktop/src/renderer/src/lib/miniapp-host-actions.ts` | Runs in the renderer; main only addresses the request |
| Session binding | `miniAppSessionTarget()` | Picks the active session if it holds the app, else the **first** of `openApps[].holderSessions` |
| Host scope | `apps/desktop/src/main/miniapp/miniapp-host.ts` | One utility process per project × app, independent of sessions |
| Collaboration graph | `CollaborationGrantRow` in `packages/runtime/src/collaboration/store.ts` | `parent_session_id → child_session_id`, `kind: 'spawn' \| 'link' \| 'handoff'` |
| Launch | `apps/desktop/src/main/session/collaboration-start.ts` | Grant, child project / worktree, system prompt, opening task |
| Messaging | collaboration mailbox (`collaboration-mailbox.ts`, runtime `mailbox.ts`) | Parent ↔ child messages; pull via `session_collab_retrieve` |
| Host wake | `apps/desktop/src/main/session/task-notification-queue.ts` | Coalescing queue that injects host notes into a session |

The session binding exists only in the UI layer. `holderSessions` conflates
three things — where the panel shows, where writes go, and whose lifetime the
app follows — which is tolerable for a prefill but ambiguous once an app drives
several sessions.

## 3. Relations

Replace the implicit holder with explicit relations:

| Relation | Meaning | Lifetime |
|---|---|---|
| invoker | The session whose `miniapp_call` is being handled. Handlers receive it as `ctx.session`. | One call |
| attached | Sessions the panel is shown beside (today's `holderSessions`). UI only. | Panel open/close |
| anchor | The session whose graph an API call operates on. Passed explicitly; defaults to the invoker inside a tool handler. | Per call |
| graph member | Any session reachable from the anchor through collaboration grants. | Grant lifetime |

An app with no user session to anchor on (a scheduled or background task)
creates its own **root session** and uses it as the anchor. The root is a
normal, visible session, so the one-model rule holds.

## 4. API sketch

```ts
interface SuperOneMiniAppAgentApi {
  // existing: sendPrompt, setContext, clearContext, onContextConsumed

  graph(anchor: string): Promise<AgentGraph>
  onGraphChange(anchor: string, cb: (graph: AgentGraph) => void): Disposable

  spawn(anchor: string, opts: LaunchOptions): Promise<AgentNode>
  link(anchor: string, sessionId: string, opts?: { task?: string }): Promise<AgentNode>
  handoff(anchor: string, opts: LaunchOptions): Promise<AgentNode>

  send(sessionId: string, message: string | Content[]): Promise<void>
  steer(sessionId: string, text: string): Promise<void>
  interrupt(sessionId: string): Promise<void>
  respond(sessionId: string, interactionId: string, answer: InteractionAnswer): Promise<void>
  read(sessionId: string, opts?: { since?: number }): Promise<AppAgentEvent[]>

  notify(anchor: string, text: string, opts?: { wake?: boolean }): Promise<void>
  createRoot(opts: LaunchOptions): Promise<AgentNode>
}

interface AgentGraph {
  anchor: AgentNode
  nodes: AgentNode[]            // every member, with depth
}

interface AgentNode {
  sessionId: string
  parentSessionId: string | null
  relation: 'root' | 'spawn' | 'link' | 'handoff'
  depth: number
  agentId: string               // provider row / Agent Profile id
  title: string | null
  status: SessionStatus
  pendingInteractions: PendingInteraction[]
  usage: Usage
  capabilities: HarnessCapabilities
}

interface LaunchOptions {
  agentId?: string              // Agent Profile, see agent-profile.md
  task: string
  cwd?: string
  worktree?: boolean
}
```

Tool handlers gain a context argument so the invoker is known without guessing:

```ts
context.tools.handle('plan', async (args, ctx) => {
  const node = await context.agent.spawn(ctx.session.id, { task: args.task })
  return { launched: node.sessionId }
})
```

## 5. Behavior rules

1. **One source of truth.** The app and the anchor's agent see the same graph.
   `session_collab_*` and `context.agent.*` are two entry points to one
   capability.
2. **Two controllers stay visible to each other.** Every app action on a graph
   (launch, send, steer, interrupt, respond) appends a host note to the anchor
   session. The note does not wake the model unless `notify(..., { wake: true })`
   asks for it, but the agent sees it on its next turn.
3. **Attribution.** Messages the app sends on the anchor's behalf carry
   `via: <appId>`, so the recipient agent and the UI can tell who is speaking.
4. **Push, not poll.** `onGraphChange` fires on status, pending interaction,
   completion and usage changes. Today collaboration is pull-only
   (`session_collab_retrieve`); this adds a push channel.
5. **Whole connected graph.** Children may launch children; the API returns every
   member with `depth`, not only direct children.
6. **Reporting back.** `notify` reuses `TaskNotificationQueue`: delivered at once
   when the anchor is idle, after the current turn when it is busy.

## 6. Implementation reuse

- Launch goes through `collaboration-start.ts`; no parallel session path.
- Launch approval uses the existing collaboration confirm path (see §9 for the
  app-specific policy).
- `respond` resolves through the Session-layer HITL registry
  (`host-confirm-registry.ts`), the same place user answers resolve.
- Remote nodes: the CLI already has a collaboration implementation
  (`apps/cli/src/session/collaboration-profiles.ts`), so the same API is served
  over node RPC.

## 7. Security

- The manifest declares the agent capability the app needs; the user grants it
  at install time. Without it, only today's prefill/context methods work.
- An app reaches only graphs anchored on sessions it was invoked from or is
  attached to, plus roots it created.
- Launched sessions never get a permission mode above the user's default.
- Tool calls inside graph sessions still go through executor-side authorization.

## 8. Phases

1. Explicit anchor: tool handler `ctx.session`, anchor parameter on existing
   methods, retire first-holder guessing.
2. Read side: `graph`, `onGraphChange`, `read`.
3. Write side: `spawn` / `link` / `handoff`, `send`, `steer`, `interrupt`,
   `respond`, `notify`, host notes and `via` attribution.
4. Root sessions for anchorless apps; scheduling through automations.

## 9. Open questions

1. Launch approval for app-initiated spawn/link/handoff: install-time grant only,
   per-launch confirm card, or a user setting. Handoff transfers control and
   likely always confirms.
2. What happens to graph sessions when the app is uninstalled: stay as ordinary
   sessions (proposed) or close.
3. How the anchor's agent learns what the app manages: summary in tool results,
   or an app-defined `status` tool convention.
4. Cross-project management needs a global-scope MiniApp Host; defer.
5. Per-app budget for sessions it launches (turns, cost), enforced at the
   metering point in [ai-gateway.md](ai-gateway.md).
