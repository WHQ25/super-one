import type { CodexGoal, CodexGoalStatus, CodexRunResult } from '@superone/shared/agent-types'
import type { CodexSession } from './codex-session'
import type { AppServerConnection, CodexProjectAuth } from './app-server-connection'
import { resolvePermissionProfile } from './app-server-connection'
import { mapCodexGoal } from './codex-goal-service'
import {
  deriveFinalResponse,
  streamTurnEvents,
  withThreadConnection,
  type CodexRunStreamCallbacks,
} from './codex-turn'

interface CodexGoalControllerOptions {
  getSession: () => CodexSession | null
  getAuth: () => CodexProjectAuth
  getCwd: () => string
  getCurrentRun: () => Promise<void> | null
  getCallbacks: () => CodexRunStreamCallbacks
  onRunStart: (messageId: string, startedAt: number) => void
  onRunComplete: (messageId: string, result: CodexRunResult, startedAt: number) => void
  onRunError: (messageId: string, error: Error) => void
  onIdle: () => void
}

export class CodexGoalController {
  private runPromise: Promise<void> | null = null
  private runController: AbortController | null = null
  private currentGoal: CodexGoal | null = null
  private rescheduleRequested = false
  private stopped = false

  constructor(private readonly options: CodexGoalControllerOptions) {}

  get active(): boolean {
    return this.runPromise !== null
  }

  get goal(): CodexGoal | null {
    return this.currentGoal
  }

  async get(threadId: string): Promise<CodexGoal | null> {
    const goal = await this.requestGoal(threadId, (connection, resolvedThreadId) =>
      connection.request('thread/goal/get', { threadId: resolvedThreadId }))
    const mapped = mapCodexGoal(goal.goal)
    this.currentGoal = mapped
    if (mapped?.status === 'active') this.schedule()
    return mapped
  }

  async set(threadId: string, objective: string, status?: CodexGoalStatus): Promise<CodexGoal | null> {
    const trimmed = objective.trim()
    if (!trimmed) throw new Error('Goal objective cannot be empty')
    const result = await this.requestGoal(threadId, (connection, resolvedThreadId) =>
      connection.request('thread/goal/set', {
        threadId: resolvedThreadId,
        objective: trimmed,
        ...(status ? { status } : {}),
      }))
    const goal = mapCodexGoal(result.goal)
    this.currentGoal = goal
    if (goal?.status === 'active') this.schedule()
    return goal
  }

  async setStatus(threadId: string, status: CodexGoalStatus): Promise<CodexGoal | null> {
    const result = await this.requestGoal(threadId, (connection, resolvedThreadId) =>
      connection.request('thread/goal/set', { threadId: resolvedThreadId, status }))
    const goal = mapCodexGoal(result.goal)
    this.currentGoal = goal
    if (goal?.status === 'active') this.schedule()
    return goal
  }

  async pause(): Promise<CodexGoal | null> {
    const threadId = this.options.getSession()?.threadId
    if (!threadId) return null
    return this.setStatus(threadId, 'paused')
  }

  async clear(threadId: string): Promise<boolean> {
    const result = await this.requestGoal(threadId, (connection, resolvedThreadId) =>
      connection.request('thread/goal/clear', { threadId: resolvedThreadId }))
    if (result.cleared === true) this.currentGoal = null
    return result.cleared === true
  }

  stop(): void {
    this.stopped = true
    this.rescheduleRequested = false
    this.runController?.abort()
    const session = this.options.getSession()
    if (session?.interruptFn) void session.interruptFn().catch(() => {})
  }

  async wait(): Promise<void> {
    await this.runPromise?.catch(() => {})
  }

  private async requestGoal(
    threadId: string,
    request: (connection: AppServerConnection, resolvedThreadId: string) => Promise<Record<string, unknown>>,
  ): Promise<Record<string, unknown>> {
    const session = this.options.getSession()
    if (!session) throw new Error('Codex session is not initialized')
    if (session.threadId && session.threadId !== threadId) {
      throw new Error(`Codex goal thread mismatch: expected ${session.threadId}, received ${threadId}`)
    }
    session.threadId = threadId
    return withThreadConnection(
      session,
      this.options.getAuth(),
      undefined,
      session.projectPath,
      this.options.getCwd(),
      resolvePermissionProfile(session.permissionPreset),
      ({ connection, threadId: resolvedThreadId, markMutationStarted }) => {
        markMutationStarted()
        return request(connection, resolvedThreadId)
      },
    )
  }

  private schedule(): void {
    if (this.stopped) return
    if (this.runPromise) {
      this.rescheduleRequested = true
      return
    }
    const currentRun = this.options.getCurrentRun()
    const task = (async () => {
      if (currentRun) await currentRun.catch(() => {})
      await this.run()
    })()
    const tracked = task.finally(() => {
      const shouldReschedule = this.rescheduleRequested
      this.rescheduleRequested = false
      if (this.runPromise === tracked) this.runPromise = null
      this.options.onIdle()
      if (shouldReschedule && this.currentGoal?.status === 'active') this.schedule()
    })
    this.runPromise = tracked
  }

  private async run(): Promise<void> {
    while (!this.stopped) {
      const session = this.options.getSession()
      const connection = session?.connectionHandle?.connection
      const threadId = session?.threadId
      if (!session || !connection || !threadId) return
      let goalResult: Record<string, unknown>
      try {
        goalResult = await connection.request('thread/goal/get', { threadId })
      } catch {
        return
      }
      const goal = mapCodexGoal(goalResult.goal)
      this.currentGoal = goal
      if (goal?.status !== 'active') return

      const messageId = `codex_goal_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const startedAt = Date.now()
      const controller = new AbortController()
      this.runController = controller
      session.runningController = controller
      this.options.onRunStart(messageId, startedAt)

      try {
        const streamed = await streamTurnEvents(
          connection,
          session,
          null,
          controller,
          this.options.getCallbacks(),
        )
        this.options.onRunComplete(messageId, {
          threadId: streamed.threadId,
          ...(streamed.turnId ? { turnId: streamed.turnId } : {}),
          finalResponse: deriveFinalResponse(streamed.items),
          usage: streamed.usage,
          items: streamed.items,
        }, startedAt)
      } catch (error) {
        this.options.onRunError(messageId, error instanceof Error ? error : new Error(String(error)))
      } finally {
        if (session.runningController === controller) session.runningController = null
        session.activeTurnId = null
        session.steerFn = null
        session.interruptFn = null
        if (this.runController === controller) this.runController = null
      }
    }
  }
}
