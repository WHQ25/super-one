/**
 * Node automation scheduler + executor.
 *
 * Polls due rows, spawns a session marked automation-owned, sends the prompt
 * via sendWithoutLease (no desktop control lease), awaits turn completion,
 * then updates last_run_* / next_run_at (disables one-time schedules).
 */

import type { AgentRunConfig } from '@superone/shared/agent-types'
import type { SessionRuntime } from '../session/session-runtime'
import { computeNextRunAt } from './schedule'
import type { AutomationRecord, AutomationStore } from './store'

const DEFAULT_POLL_INTERVAL_MS = 30_000
const DEFAULT_TURN_TIMEOUT_MS = 30 * 60_000
const POLL_STATUS_MS = 100

export interface AutomationServiceDeps {
  store: AutomationStore
  sessions: SessionRuntime
  /** Resolve absolute project path for session cwd / validation. */
  resolveProjectPath: (projectId: string) => string | null
  pollIntervalMs?: number
  turnTimeoutMs?: number
  /** Optional logger (defaults to console). */
  log?: {
    info: (...args: unknown[]) => void
    error: (...args: unknown[]) => void
  }
}

function harnessFromConfig(config: AgentRunConfig): string {
  return config.type
}

function turnOptionsFromConfig(config: AgentRunConfig): {
  model?: string | null
  effort?: string | null
  permissionMode?: string | null
  sandboxMode?: string | null
  apiProviderId?: string | null
} {
  if (config.type === 'codex') {
    const effort = config.effort ?? config.reasoningEffort ?? null
    const permissionMode =
      config.permissionMode
      ?? config.permissionPreset
      ?? 'full-access'
    return {
      model: config.model ?? null,
      effort,
      permissionMode,
      sandboxMode: null,
      apiProviderId: config.apiProviderId ?? null,
    }
  }
  if (config.type === 'claude') {
    return {
      model: config.model ?? null,
      effort: config.effort ?? null,
      permissionMode: config.permissionMode ?? 'bypassPermissions',
      sandboxMode: config.sandboxMode ?? 'off',
      apiProviderId: config.apiProviderId ?? null,
    }
  }
  // acp / opencode
  return {
    model: config.model ?? null,
    effort: config.effort ?? null,
    permissionMode: config.permissionMode ?? 'bypassPermissions',
    sandboxMode: null,
    apiProviderId: config.apiProviderId ?? null,
  }
}

export class AutomationService {
  private pollInterval: ReturnType<typeof setInterval> | null = null
  private stopped = true
  private readonly runningAutomations = new Set<string>()
  private readonly pollIntervalMs: number
  private readonly turnTimeoutMs: number
  private readonly log: NonNullable<AutomationServiceDeps['log']>

  constructor(private readonly deps: AutomationServiceDeps) {
    this.pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
    this.turnTimeoutMs = deps.turnTimeoutMs ?? DEFAULT_TURN_TIMEOUT_MS
    this.log = deps.log ?? {
      info: (...args) => console.info('[AutomationService]', ...args),
      error: (...args) => console.error('[AutomationService]', ...args),
    }
  }

  start(): void {
    this.stopped = false
    this.log.info('starting scheduler')
    try {
      this.deps.store.refreshAllNextRunAt()
    } catch (e) {
      this.log.error('failed to refresh nextRunAt on startup:', e)
    }
    this.pollInterval = setInterval(() => this.checkDueAutomations(), this.pollIntervalMs)
    if (typeof this.pollInterval === 'object' && this.pollInterval && 'unref' in this.pollInterval) {
      this.pollInterval.unref()
    }
    this.checkDueAutomations()
  }

  stop(): void {
    this.stopped = true
    this.log.info('stopping scheduler')
    if (this.pollInterval) {
      clearInterval(this.pollInterval)
      this.pollInterval = null
    }
    this.runningAutomations.clear()
  }

  /** Immediate run (RPC automation.runNow). Reuses execute path. */
  async runNow(automationId: string): Promise<{ sessionId?: string; status: string }> {
    const automation = this.deps.store.get(automationId)
    if (!automation) {
      throw Object.assign(new Error(`Automation not found: ${automationId}`), { code: 'not_found' })
    }
    if (this.runningAutomations.has(automationId)) {
      throw Object.assign(new Error(`Automation already running: ${automationId}`), {
        code: 'failed_precondition',
      })
    }
    return this.executeAutomation(automation)
  }

  private checkDueAutomations(): void {
    if (this.stopped) return
    try {
      const now = new Date().toISOString()
      const due = this.deps.store.listDue(now)
      for (const automation of due) {
        if (this.stopped) return
        if (this.runningAutomations.has(automation.id)) continue
        // Skip rows whose project no longer exists on this node.
        if (!this.deps.resolveProjectPath(automation.projectId)) continue
        this.executeAutomation(automation).catch((err) => {
          if (this.stopped) return
          this.log.error(`execution failed for ${automation.id}:`, err)
        })
      }
    } catch (e) {
      if (this.stopped) return
      // Ignore races where the host closed SQLite before stop() completed.
      const msg = e instanceof Error ? e.message : String(e)
      if (/not open|database is closed/i.test(msg)) return
      this.log.error('checkDueAutomations error:', e)
    }
  }

  private async executeAutomation(
    automation: AutomationRecord,
  ): Promise<{ sessionId?: string; status: string }> {
    if (this.stopped) {
      return { status: 'error' }
    }
    this.runningAutomations.add(automation.id)
    try {
      this.deps.store.updateRunStatus(automation.id, 'running')
    } catch {
      this.runningAutomations.delete(automation.id)
      return { status: 'error' }
    }

    let sessionId: string | undefined
    try {
      if (this.stopped) {
        throw Object.assign(new Error('automation service stopped'), { code: 'failed_precondition' })
      }
      const projectPath = this.deps.resolveProjectPath(automation.projectId)
      if (!projectPath) {
        throw Object.assign(new Error(`project not found: ${automation.projectId}`), {
          code: 'not_found',
        })
      }

      const harnessId = harnessFromConfig(automation.agentConfig)
      const turnOpts = turnOptionsFromConfig(automation.agentConfig)
      const title = `[Auto] ${automation.name}`

      const session = this.deps.sessions.create({
        projectId: automation.projectId,
        harnessId,
        providerId: `${harnessId}-base`,
        title,
        cwd: projectPath,
        model: turnOpts.model,
        effort: turnOpts.effort,
        permissionMode: turnOpts.permissionMode,
        sandboxMode: turnOpts.sandboxMode,
        apiProviderId: turnOpts.apiProviderId,
        // Node-owned: no paired desktop controller required for scheduled runs.
        controllerClientSessionId: null,
        isAutomation: true,
        automationId: automation.id,
      })
      sessionId = session.sessionId

      await this.deps.sessions.sendWithoutLease({
        sessionId: session.sessionId,
        text: automation.prompt,
        model: turnOpts.model,
        effort: turnOpts.effort,
        permissionMode: turnOpts.permissionMode,
        sandboxMode: turnOpts.sandboxMode,
        requestId: `automation-${automation.id}-${Date.now()}`,
      })

      await this.awaitTurnCompletion(session.sessionId)

      if (this.stopped) return { sessionId, status: 'error' }

      const nextRunAt = computeNextRunAt(automation.schedule)
      this.deps.store.updateRunStatus(automation.id, 'completed', sessionId, nextRunAt ?? null)
      if (automation.schedule.type === 'one-time') {
        this.deps.store.update(automation.id, { enabled: false })
      }
      this.log.info(`completed automation: ${automation.name} (session: ${sessionId})`)
      return { sessionId, status: 'completed' }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      if (!this.stopped) {
        this.log.error(`error in automation ${automation.id}:`, errorMsg)
        try {
          const nextRunAt = computeNextRunAt(automation.schedule)
          this.deps.store.updateRunStatus(automation.id, 'error', sessionId, nextRunAt ?? null)
        } catch {
          /* db may already be closed during shutdown */
        }
      }
      return { sessionId, status: 'error' }
    } finally {
      this.runningAutomations.delete(automation.id)
    }
  }

  private async awaitTurnCompletion(sessionId: string): Promise<void> {
    const deadline = Date.now() + this.turnTimeoutMs
    while (Date.now() < deadline) {
      if (this.stopped) {
        throw Object.assign(new Error('automation service stopped'), { code: 'failed_precondition' })
      }
      const s = this.deps.sessions.get(sessionId)
      if (!s) return
      if (s.status !== 'streaming') return
      await new Promise((r) => setTimeout(r, POLL_STATUS_MS))
    }
    throw Object.assign(new Error(`automation turn timed out for session ${sessionId}`), {
      code: 'failed_precondition',
    })
  }
}
