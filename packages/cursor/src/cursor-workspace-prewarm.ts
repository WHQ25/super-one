/**
 * Official Cursor SDK workspace prewarm (`createAgentPlatform` +
 * `prewarmLocalWorkspace`). Warms the local executor (rules / skills / MCP /
 * ignore map) that Agent.create later acquires from the process-wide cache.
 */

import { createAgentPlatform, type CursorAgentPlatform } from '@cursor/sdk'
import type { CursorRuntimeLog, CursorRuntimeOptions } from './cursor-runtime'
import { createCursorSdkTracer } from './cursor-sdk-trace'
import {
  buildCursorWorkspaceAgentOptions,
  cursorWorkspacePrewarmKey,
  resolveCursorLocalSessionPlan,
} from './cursor-local-options'
import { withCursorPlatformLookup } from './cursor-platform-binaries'

const noopLog: Required<CursorRuntimeLog> = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
}

let platformPromise: Promise<CursorAgentPlatform> | null = null
let held: { key: string; release: () => Promise<void> } | null = null
let generation = 0

function getDefaultPlatform(): Promise<CursorAgentPlatform> {
  platformPromise ??= createAgentPlatform()
  return platformPromise
}

/** Test hook: drop the held workspace lease and cached platform. */
export async function resetCursorWorkspacePrewarmForTests(): Promise<void> {
  generation += 1
  const prev = held
  held = null
  platformPromise = null
  if (prev) await prev.release().catch(() => undefined)
}

export async function prewarmCursorLocalWorkspace(opts: CursorRuntimeOptions): Promise<void> {
  const log = {
    info: opts.log?.info ?? noopLog.info,
    warn: opts.log?.warn ?? noopLog.warn,
    debug: opts.log?.debug ?? noopLog.debug,
  }
  const tracer = createCursorSdkTracer(opts.onSdkTrace)
  const plan = resolveCursorLocalSessionPlan(opts)
  if (plan.isCloud) {
    log.debug('[CursorRuntime] skip official workspace prewarm (cloud agent)')
    tracer.runtime('prewarm_skip', { reason: 'cloud', sessionId: opts.sessionId }, opts.sessionId)
    return
  }
  if (!plan.apiKey) {
    log.debug('[CursorRuntime] skip official workspace prewarm (no API key)')
    tracer.runtime('prewarm_skip', { reason: 'no_api_key', sessionId: opts.sessionId }, opts.sessionId)
    return
  }
  const key = cursorWorkspacePrewarmKey(opts.cwd, plan)
  if (held?.key === key) {
    tracer.runtime('prewarm_held', { sessionId: opts.sessionId, cwd: opts.cwd }, opts.sessionId)
    return
  }

  const token = ++generation
  const started = Date.now()
  const agentOptions = buildCursorWorkspaceAgentOptions(opts.cwd, plan)
  log.info('[CursorRuntime] official workspace prewarm start', {
    cwd: opts.cwd,
    sandboxEnabled: plan.sandboxEnabled,
    mcpCount: Object.keys(plan.mcpServers).length,
  })
  tracer.runtime('prewarm_start', {
    cwd: opts.cwd,
    sandboxEnabled: plan.sandboxEnabled,
    mcpCount: Object.keys(plan.mcpServers).length,
  }, opts.sessionId)

  const platform = await getDefaultPlatform()
  const release = await withCursorPlatformLookup(() => platform.prewarmLocalWorkspace(agentOptions))
  if (token !== generation) {
    await release().catch(() => undefined)
    return
  }
  const prev = held
  held = { key, release }
  if (prev) await prev.release().catch(() => undefined)
  log.info('[CursorRuntime] official workspace prewarm ready', { ms: Date.now() - started })
  tracer.runtime('prewarm_ready', { ms: Date.now() - started, cwd: opts.cwd }, opts.sessionId)
}
