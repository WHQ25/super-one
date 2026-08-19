import type { Context } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import LocalBashExecutor from '@deepseek-ai/dsh-bash-local'
import * as ShellEnv from '@deepseek-ai/dsh-shell-env'
import * as ToolFs from '@deepseek-ai/dsh-tool-fs'
import * as ToolFsSearch from '@deepseek-ai/dsh-tool-fs-search'
import * as ToolBash from '@deepseek-ai/dsh-tool-bash'
import * as ToolTodo from '@deepseek-ai/dsh-tool-todo'
import { isStaticHostOwnedSuperoneToolQualified } from '@superone/shared/superone-host-owned-tools'
import { mountSuperoneTools, type SuperoneToolSurface } from './tool-surface'

export type ToolApprovalDecision = 'allowed-once' | 'rejected' | 'cancelled'

export interface DeepseekToolPermissionRequest {
  toolName: string
  /** Parsed call arguments — what the permission popover renders. */
  input: Record<string, unknown>
  callId?: string
  /**
   * dsh session that made the call. Equals the SuperOne session for a top-level
   * agent; for a delegated child it is the child's own session, while the
   * prompt is answered by the SuperOne session that owns its ancestry.
   */
  agentSessionId?: string
  /** Aborts when the turn is cancelled; settle promptly after it fires. */
  signal?: AbortSignal
}

export interface DeepseekToolPlaneOptions {
  /**
   * SuperOne's own tools (browser, media, widget, mini-app, config…), registered
   * natively on the agent scope. Omitted, the session runs with dsh's file and
   * shell tools only.
   */
  superoneTools?: SuperoneToolSurface
  /**
   * Ask the user before a mutating tool runs. Resolving `allowed-once` releases
   * the parked call; anything else denies it with a model-readable reason.
   */
  requestPermission: (request: DeepseekToolPermissionRequest) => Promise<ToolApprovalDecision>
}

/**
 * Tools that only observe. They run without a prompt in every permission mode:
 * SuperOne's popover exists to gate effects, and asking for a `read` is the
 * fastest way to train users to click through the ones that matter.
 *
 * `subagent` is here for a different reason: delegating is not itself an
 * effect, and every effect the child then produces passes this same gate under
 * the child's own call. Prompting for the delegation too would ask twice for
 * one action.
 */
const READ_ONLY_TOOLS = new Set(['read', 'read_image', 'glob', 'grep', 'todo_write', 'subagent'])

/** Denial reasons the model reads; phrased so it stops instead of retrying. */
const DENIAL_REASONS: Record<Exclude<ToolApprovalDecision, 'allowed-once'>, (tool: string) => string> = {
  rejected: (tool) => `the user rejected tool "${tool}" — do not retry it without new instructions`,
  cancelled: (tool) => `approval for tool "${tool}" was cancelled`,
}

/**
 * Mount dsh's own executors and model-facing tool rows on the HOST plane —
 * once for the whole tree, covering every agent in it.
 *
 * This used to live on each agent's scope, isolated per session. Delegation is
 * what ruled that out. dsh composes a child agent by joining its parent's
 * *preset* composition (`applyChildComposition`); a deployment that runs no
 * preset roster — ours, by D3 — joins nothing, so anything registered on the
 * parent's agent scope is invisible to its children and a child would reach the
 * model with an empty tool registry. dsh's own rosterless shape puts the
 * model-facing rows in the host composition instead, where the child resolves
 * them through the tool registry's global layer.
 *
 * Per-session correctness survives the move because dsh resolves the workspace
 * at the *tool* boundary, not at mount time: `tool-fs` passes the calling
 * agent's `session.header.cwd` into `ctx.fs.resolve()`, and `tool-bash`
 * defaults `workdir` the same way. `config.cwd` is only the fallback for a
 * non-agent caller. (Covered by the "keeps each session rooted in its own cwd"
 * test, which is why it kept passing across this change.)
 */
export async function mountHostToolPlane(ctx: Context): Promise<void> {
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(LocalFileSystem, {})
  await ctx.plugin(LocalBashExecutor, {})
  await ctx.plugin(ShellEnv, {})

  await ctx.plugin(ToolFs, {})
  // Sampling keeps an over-cap glob honest about what it dropped instead of
  // silently returning the first N directory entries.
  await ctx.plugin(ToolFsSearch, { sampleOverCapGlobResults: true })
  await ctx.plugin(ToolBash, {})
  // One in-progress todo at a time mirrors every other SuperOne harness's panel.
  await ctx.plugin(ToolTodo, { allowParallelInProgress: false })
}

/**
 * Mount the per-session half of the tool plane on one agent's scope.
 *
 * Only SuperOne's own tools live here, because only they are per session: the
 * surface a session may see depends on its feature gates, its registered
 * mini-apps and whether a phone is subscribed to it. The cost is that a
 * delegated child does not inherit them — it runs with dsh's file, search,
 * shell and todo tools alone.
 */
export async function mountToolPlane(
  agentCtx: Context,
  options: DeepseekToolPlaneOptions,
): Promise<void> {
  if (!options.superoneTools) return
  try {
    mountSuperoneTools(agentCtx, options.superoneTools)
  } catch (error) {
    // `setup` rejecting rolls the whole scope back and the session is never
    // published, so a broken tool surface costs the tools, not the session.
    console.warn('[deepseek] superone tools unavailable:', error)
  }
}

/**
 * Gate mutating calls on SuperOne's permission popover, for every agent in the
 * tree.
 *
 * Host-plane like the tools it guards, and for the same reason: a gate on the
 * parent's agent scope never sees a delegated child's calls, so a child would
 * run `write` and `bash` with no prompt at all. `answer` receives the calling
 * agent's session id and is responsible for routing the question to the
 * SuperOne session that owns it (see `DeepseekRuntime`). Returning `undefined`
 * defers the call to dsh's own approval waterfall — that is how a session
 * running without a SuperOne answerer keeps dsh's native policy instead of
 * inheriting a gate nobody can answer.
 *
 * It asks through the injected callback rather than returning dsh's
 * `{kind:'ask'}`: `ctx.approval` carries only a tool name, while the popover is
 * built to show the call — the bash command, the file being written. The
 * callback is the same answerer `approval/request` routes to, so dsh's own
 * sandbox-escalation asks still land on the same UI.
 */
export function installPermissionGate(
  ctx: Context,
  answer: (request: DeepseekToolPermissionRequest) => Promise<ToolApprovalDecision | undefined>,
): void {
  ctx.on('tools/pre-execute', (async (
    exec: {
      name: string
      arguments?: unknown
      callId?: unknown
      signal?: AbortSignal
      agent?: { session: { header: { id: unknown } } }
    },
    next: () => Promise<unknown>,
  ) => {
    if (READ_ONLY_TOOLS.has(exec.name)) return next()
    // Layer A admission: SuperOne's own host-owned tools are admitted here so
    // their executor — which runs the real product confirmation — is the thing
    // that authorizes the effect. Dynamic mini-app / third-party tools sharing
    // the `mcp__superone__` prefix are deliberately not matched.
    if (isStaticHostOwnedSuperoneToolQualified(exec.name)) return next()

    const agentSessionId = exec.agent?.session.header.id
    const decision = await answer({
      toolName: exec.name,
      input: toInput(exec.arguments),
      ...(exec.callId !== undefined ? { callId: String(exec.callId) } : {}),
      ...(agentSessionId !== undefined ? { agentSessionId: String(agentSessionId) } : {}),
      ...(exec.signal !== undefined ? { signal: exec.signal } : {}),
    })
    if (decision === undefined) return next()
    if (decision === 'allowed-once') return { kind: 'allow' }
    return { kind: 'deny', reason: DENIAL_REASONS[decision](exec.name) }
  }) as never)
}

function toInput(args: unknown): Record<string, unknown> {
  return args && typeof args === 'object' && !Array.isArray(args)
    ? (args as Record<string, unknown>)
    : {}
}
