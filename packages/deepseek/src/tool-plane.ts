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
  /** Aborts when the turn is cancelled; settle promptly after it fires. */
  signal?: AbortSignal
}

export interface DeepseekToolPlaneOptions {
  /** Session working directory: the filesystem and shell executors are rooted here. */
  cwd: string
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
 */
const READ_ONLY_TOOLS = new Set(['read', 'read_image', 'glob', 'grep', 'todo_write'])

/** Denial reasons the model reads; phrased so it stops instead of retrying. */
const DENIAL_REASONS: Record<Exclude<ToolApprovalDecision, 'allowed-once'>, (tool: string) => string> = {
  rejected: (tool) => `the user rejected tool "${tool}" — do not retry it without new instructions`,
  cancelled: (tool) => `approval for tool "${tool}" was cancelled`,
}

/**
 * Mount one session's tool plane on its agent scope.
 *
 * Two dsh mechanics carry the whole design:
 * - registrations made under an agent's scoped context file into *that agent's*
 *   layer (`ctx.tools` resolves per scope key), so tools and the gate below are
 *   per session even though the Cordis tree is shared by the whole app;
 * - `isolate()` gives the executors a private service realm. Without it the
 *   first session's `ctx.fs`/`ctx.shell` would land in the root realm — process
 *   global, rooted at that session's cwd, and colliding with session two.
 */
export async function mountToolPlane(
  agentCtx: Context,
  options: DeepseekToolPlaneOptions,
): Promise<void> {
  const toolCtx = agentCtx
    .isolate('subprocess')
    .isolate('fs')
    .isolate('shell')
    .isolate('shellEnv')

  await toolCtx.plugin(LocalSubprocessRuntime)
  await toolCtx.plugin(LocalFileSystem, { cwd: options.cwd })
  await toolCtx.plugin(LocalBashExecutor, { cwd: options.cwd })
  await toolCtx.plugin(ShellEnv, {})

  await toolCtx.plugin(ToolFs, {})
  // Sampling keeps an over-cap glob honest about what it dropped instead of
  // silently returning the first N directory entries.
  await toolCtx.plugin(ToolFsSearch, { sampleOverCapGlobResults: true })
  await toolCtx.plugin(ToolBash, {})
  // One in-progress todo at a time mirrors every other SuperOne harness's panel.
  await toolCtx.plugin(ToolTodo, { allowParallelInProgress: false })

  if (options.superoneTools) {
    try {
      mountSuperoneTools(agentCtx, options.superoneTools)
    } catch (error) {
      // `setup` rejecting rolls the whole scope back and the session is never
      // published, so a broken tool surface costs the tools, not the session.
      console.warn('[deepseek] superone tools unavailable:', error)
    }
  }

  installPermissionGate(agentCtx, options.requestPermission)
}

/**
 * Gate mutating calls on SuperOne's permission popover.
 *
 * This asks through the injected callback rather than returning dsh's
 * `{kind:'ask'}`: `ctx.approval` carries only a tool name, while the popover is
 * built to show the call — the bash command, the file being written. The
 * callback is the same answerer `approval/request` routes to, so dsh's own
 * sandbox-escalation asks still land on the same UI.
 */
export function installPermissionGate(
  agentCtx: Context,
  requestPermission: (request: DeepseekToolPermissionRequest) => Promise<ToolApprovalDecision>,
): void {
  agentCtx.on('tools/pre-execute', (async (
    exec: { name: string; arguments?: unknown; callId?: unknown; signal?: AbortSignal },
    next: () => Promise<unknown>,
  ) => {
    if (READ_ONLY_TOOLS.has(exec.name)) return next()
    // Layer A admission: SuperOne's own host-owned tools are admitted here so
    // their executor — which runs the real product confirmation — is the thing
    // that authorizes the effect. Dynamic mini-app / third-party tools sharing
    // the `mcp__superone__` prefix are deliberately not matched.
    if (isStaticHostOwnedSuperoneToolQualified(exec.name)) return next()

    const decision = await requestPermission({
      toolName: exec.name,
      input: toInput(exec.arguments),
      ...(exec.callId !== undefined ? { callId: String(exec.callId) } : {}),
      ...(exec.signal !== undefined ? { signal: exec.signal } : {}),
    })
    if (decision === 'allowed-once') return { kind: 'allow' }
    return { kind: 'deny', reason: DENIAL_REASONS[decision](exec.name) }
  }) as never)
}

function toInput(args: unknown): Record<string, unknown> {
  return args && typeof args === 'object' && !Array.isArray(args)
    ? (args as Record<string, unknown>)
    : {}
}
