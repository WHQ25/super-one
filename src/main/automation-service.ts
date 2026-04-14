import log from './logger'
import type { AgentService } from './agent/agent-service'
import {
  getAutomation,
  listDueAutomations,
  updateAutomationRunStatus,
  updateAutomation as dbUpdateAutomation,
  computeNextRunAt,
  refreshAllNextRunAt,
} from './db-automations'
import type { BrowserWindow } from 'electron'
import type { Automation, AgentEvent, AutomationRunStatus } from '../shared/agent-types'
import { AgentIpcChannels } from '../shared/agent-types'

const POLL_INTERVAL_MS = 30_000

export interface AutomationRunEvent {
  automationId: string
  status: AutomationRunStatus
  sessionId?: string
  error?: string
}

export class AutomationService {
  private pollInterval: ReturnType<typeof setInterval> | null = null
  private runningAutomations = new Set<string>()
  private mainWindow: BrowserWindow | null = null
  private agentService: AgentService | null = null

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window
  }

  setAgentService(agentService: AgentService): void {
    this.agentService = agentService
  }

  start(): void {
    log.info('[AutomationService] starting scheduler')
    try {
      refreshAllNextRunAt()
    } catch (e) {
      log.error('[AutomationService] failed to refresh nextRunAt on startup:', e)
    }
    this.pollInterval = setInterval(() => this.checkDueAutomations(), POLL_INTERVAL_MS)
    this.checkDueAutomations()
  }

  stop(): void {
    log.info('[AutomationService] stopping scheduler')
    if (this.pollInterval) {
      clearInterval(this.pollInterval)
      this.pollInterval = null
    }
    this.runningAutomations.clear()
  }

  async runNow(automationId: string): Promise<void> {
    const automation = getAutomation(automationId)
    if (!automation) throw new Error(`Automation not found: ${automationId}`)
    if (this.runningAutomations.has(automationId)) {
      throw new Error(`Automation already running: ${automationId}`)
    }
    await this.executeAutomation(automation)
  }

  private checkDueAutomations(): void {
    try {
      const now = new Date().toISOString()
      const dueAutomations = listDueAutomations(now)
      for (const automation of dueAutomations) {
        if (this.runningAutomations.has(automation.id)) continue
        this.executeAutomation(automation).catch((err) => {
          log.error(`[AutomationService] execution failed for ${automation.id}:`, err)
        })
      }
    } catch (e) {
      log.error('[AutomationService] checkDueAutomations error:', e)
    }
  }

  private async executeAutomation(automation: Automation): Promise<void> {
    if (!this.agentService) {
      log.error('[AutomationService] agentService not set')
      return
    }

    await this.withLifecycle(automation, async () => {
      if (automation.agentConfig.type === 'codex') {
        const result = await this.agentService!.runCodexAutomationSession(automation.projectPath, {
          content: automation.prompt,
          model: automation.agentConfig.model,
          reasoningEffort: automation.agentConfig.reasoningEffort,
          permissionPreset: automation.agentConfig.permissionPreset ?? 'full-access',
          automationId: automation.id,
          automationName: automation.name,
        })
        return result.sessionId
      }

      let sdkSessionId: string | undefined
      let unsub: (() => void) | undefined
      try {
        const completionPromise = new Promise<void>((resolve, reject) => {
          unsub = this.agentService!.addEventSubscriber((event: AgentEvent) => {
            if (!sdkSessionId && event.type === 'session_init' && event.session?.sessionId && event.projectPath === automation.projectPath) {
              sdkSessionId = event.session.sessionId
            }
            if (sdkSessionId && event.sessionId === sdkSessionId) {
              if (event.type === 'message_complete' || event.type === 'message_interrupted') resolve()
              else if (event.type === 'message_error') reject(new Error('Agent message error'))
            }
          })
        })

        const result = await this.agentService!.runAutomationSession(automation.projectPath, {
          content: automation.prompt,
          model: automation.agentConfig.model,
          effort: automation.agentConfig.effort,
          permissionMode: automation.agentConfig.permissionMode ?? 'bypassPermissions',
          automationId: automation.id,
          automationName: automation.name,
        })
        if (result.sessionId) sdkSessionId = result.sessionId

        await completionPromise
        return sdkSessionId
      } finally {
        unsub?.()
      }
    })
  }

  private async withLifecycle(
    automation: Automation,
    runner: () => Promise<string | undefined>,
  ): Promise<void> {
    this.runningAutomations.add(automation.id)
    updateAutomationRunStatus(automation.id, 'running')
    this.broadcastEvent({ automationId: automation.id, status: 'running' })

    let sessionId: string | undefined
    try {
      sessionId = await runner()
      const nextRunAt = computeNextRunAt(automation.schedule)
      updateAutomationRunStatus(automation.id, 'completed', sessionId, nextRunAt ?? null)
      if (automation.schedule.type === 'one-time') {
        dbUpdateAutomation(automation.id, { enabled: false })
      }
      this.broadcastEvent({ automationId: automation.id, status: 'completed', sessionId })
      this.notifySessionsChanged()
      log.info(`[AutomationService] completed automation: ${automation.name} (session: ${sessionId})`)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      log.error(`[AutomationService] error in automation ${automation.id}:`, errorMsg)
      const nextRunAt = computeNextRunAt(automation.schedule)
      updateAutomationRunStatus(automation.id, 'error', sessionId, nextRunAt ?? null)
      this.broadcastEvent({ automationId: automation.id, status: 'error', error: errorMsg })
    } finally {
      this.runningAutomations.delete(automation.id)
    }
  }

  private broadcastEvent(event: AutomationRunEvent): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(AgentIpcChannels.AUTOMATIONS_EVENT, event)
    }
  }

  private notifySessionsChanged(): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(AgentIpcChannels.SESSIONS_CHANGED)
    }
  }
}
