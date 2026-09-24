/**
 * dsh background jobs as SuperOne tasks.
 *
 * A background shell command or workflow is a job in dsh's registry
 * (`ctx.jobs`): the tool call returns a job id and the work keeps running.
 * SuperOne's background list reads the same `task_started` →
 * `task_notification` pair every harness emits for such work, keyed by the
 * tool call that launched it.
 *
 * "Background" is decided by what happened, not by an argument: a job is one
 * when the tool call that registered it RETURNED while the job was still live.
 * That covers `run_in_background: true`, a foreground command promoted to a
 * job on timeout, and a background workflow alike — and leaves out the job a
 * foreground `bash` registers and settles before it returns.
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import type { Context } from '@deepseek-ai/cordis'
import type { JobEvent, JobId } from '@deepseek-ai/dsh-jobs'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { AgentEvent } from '@superone/shared/agent-types'

/** One tool call in flight, and the jobs registered while it ran. */
export interface ToolCallSpan {
  toolUseId: string
  /** The CALLING agent's dsh session. */
  agentSessionId: string
  /** Set for a delegation call: the label its Task block shows. */
  delegation?: { description: string }
  jobs: Array<{ id: JobId; owner: SessionId | undefined; label: string; kind: string }>
}

/** Carried through everything a tool call awaits, so a job can name its call. */
export const toolCallSpan = new AsyncLocalStorage<ToolCallSpan>()

/** Where a job's task events go: the top-level session the work belongs to. */
export interface TaskSink {
  /** Stable identity of the owning top-level session. */
  key: object
  onEvent: (event: AgentEvent) => void
}

interface BackgroundJob {
  id: JobId
  owner: SessionId | undefined
  toolUseId: string
  sink: TaskSink
}

/** Jobs are `bash`/`workflow`/…; a one-shot subagent job is already a Task block. */
const SUBAGENT_JOB_KIND = 'subagent'

const TASK_STATUS = { completed: 'completed', killed: 'stopped', failed: 'failed' } as const

export class DeepseekBackgroundJobs {
  private readonly live = new Map<JobId, BackgroundJob>()

  /**
   * @param ctx - a context that resolves `ctx.jobs`.
   * @param sinkFor - the top-level session a calling agent's session belongs to.
   */
  constructor(
    private readonly ctx: Context,
    private readonly sinkFor: (agentSessionId: string) => TaskSink | undefined,
  ) {}

  /**
   * Observe the registry.
   * @returns the disposer, or undefined when no registry is mounted.
   */
  subscribe(): (() => void) | undefined {
    return this.ctx.get('jobs')?.events.subscribe({ owners: 'all' }, (event) => this.observe(event))
  }

  /**
   * The launching call returned: promote the jobs it left running.
   * @param span - the call that just settled.
   */
  settleCall(span: ToolCallSpan): void {
    const jobs = this.ctx.get('jobs')
    if (!jobs || span.jobs.length === 0) return
    const sink = this.sinkFor(span.agentSessionId)
    if (!sink) return
    for (const job of span.jobs) {
      const view = jobs.list(job.owner).find((candidate) => candidate.id === job.id)
      if (view?.status !== 'running' && view?.status !== 'stopping') continue
      this.live.set(job.id, { id: job.id, owner: job.owner, toolUseId: span.toolUseId, sink })
      sink.onEvent({
        type: 'task_started',
        taskId: job.id,
        toolUseId: span.toolUseId,
        description: job.label,
        taskType: job.kind,
      })
    }
  }

  /** Whether any job of this session is still running. */
  has(sink: object): boolean {
    for (const job of this.live.values()) if (job.sink.key === sink) return true
    return false
  }

  /**
   * Ask one job to stop; its settlement closes the task.
   * @returns whether the id named a live job of this session.
   */
  kill(sink: object, taskId: string): boolean {
    const job = this.live.get(taskId as JobId)
    if (!job || job.sink.key !== sink) return false
    this.ctx.get('jobs')?.kill(job.id, job.owner, 'stopped from SuperOne')
    return true
  }

  /** Stop every job of this session. */
  killAll(sink: object): void {
    for (const job of [...this.live.values()]) if (job.sink.key === sink) this.kill(sink, job.id)
  }

  /**
   * Close this session's tasks without waiting for dsh: the session is going
   * away, and nothing would reach it after.
   */
  forget(sink: object): void {
    for (const job of [...this.live.values()]) {
      if (job.sink.key !== sink) continue
      this.live.delete(job.id)
      job.sink.onEvent({ type: 'task_notification', taskId: job.id, toolUseId: job.toolUseId, taskStatus: 'stopped', outputFile: '' })
    }
  }

  private observe(event: JobEvent): void {
    if (event.type === 'registered') {
      if (event.job.kind === SUBAGENT_JOB_KIND) return
      // Registration is dispatched synchronously inside `jobs.start()`, so the
      // launching call's span is the active async context.
      toolCallSpan.getStore()?.jobs.push({
        id: event.job.id,
        owner: event.job.owner,
        label: event.job.label,
        kind: event.job.kind,
      })
      return
    }
    if (event.type !== 'settled') return
    const job = this.live.get(event.job.id)
    if (!job) return
    this.live.delete(job.id)
    const status = event.job.status === 'completed' || event.job.status === 'killed' || event.job.status === 'failed'
      ? TASK_STATUS[event.job.status]
      : 'failed'
    job.sink.onEvent({
      type: 'task_notification',
      taskId: job.id,
      toolUseId: job.toolUseId,
      taskStatus: status,
      outputFile: '',
      ...(event.job.detail ? { summary: event.job.detail } : {}),
    })
  }
}
