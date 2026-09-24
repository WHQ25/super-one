import type { AgentEvent, AgentStatus } from '@superone/shared/agent-types'

/**
 * What a session's backend is doing, reduced from its own events — the same
 * facts the desktop renderer reduces — rather than from `Session._status`.
 *
 * `_status` only spans an awaited `Session.send`, and a *continuation* turn
 * never comes back through it: Claude's `priority:'next'` send returns as soon
 * as the message is pushed and the real turn is flushed at the next step
 * boundary, `QueuedUserMessageQueue.flush()` re-enters `backend.send` directly,
 * and Codex drains its durable queue inside the live stream. During those turns
 * `_status` is already `'ended'`, which used to make `interrupt()` return false
 * without ever reaching `backend.interrupt()` — Stop looked acknowledged while
 * the agent kept writing.
 */
export class SessionLiveness {
  private streaming = false
  /** The backend's last non-streaming `status_change`; back to idle with the runtime. */
  private settledStatus: Exclude<AgentStatus, 'streaming'> = 'idle'
  /** Between `realtime_started` and `realtime_closed` / `realtime_error`. */
  private realtime = false
  /**
   * A normal send holds a user message the backend has not answered yet — the
   * spawn and first request before any run event. The renderer's
   * `awaitingAssistantReply`; cleared by the backend's first word or the send's end.
   */
  private awaitingTurn = false
  /**
   * Bumped every time a run opens. `interrupt()` clears the stream in a
   * `finally` that awaits the backend, so a turn started during that await would
   * otherwise be cleared by a decision made before it existed.
   *
   * Only monotonicity is contractual, not the count: a normal turn bumps twice
   * (`message_start` then `status_change: 'streaming'`), and OpenCode re-announces
   * on busy/retry. Every consumer asks "did this change while I was awaiting?",
   * never "how many runs have there been".
   */
  private generation = 0

  get backendStreaming(): boolean { return this.streaming }
  get realtimeActive(): boolean { return this.realtime }
  get streamGeneration(): number { return this.generation }

  /** What a sidebar shows for this session, on every client. */
  status(): AgentStatus {
    return this.streaming || this.awaitingTurn ? 'streaming' : this.settledStatus
  }

  apply(event: AgentEvent): void {
    if (event.type === 'status_change') {
      if (event.status === 'streaming') this.openRun()
      else {
        this.streaming = false
        this.awaitingTurn = false
        this.settledStatus = event.status
      }
    } else if (event.type === 'message_start' && event.message.role === 'assistant') {
      this.openRun()
    } else if (event.type === 'message_interrupted' || event.type === 'message_error') {
      // A terminal event for the whole run. `message_complete` is deliberately
      // absent: Codex fires one at every queued-turn boundary while the stream
      // continues, and only `status_change: 'idle'` closes that run.
      this.streaming = false
      this.awaitingTurn = false
    }
    if (event.type === 'realtime_started') this.realtime = true
    else if (event.type === 'realtime_closed' || event.type === 'realtime_error') this.realtime = false
  }

  beginSend(): void { this.awaitingTurn = true }
  endSend(): void { this.awaitingTurn = false }

  /**
   * An interrupt that never lands a terminal event must not leave the session
   * permanently "busy" — but only the run it set out to stop is cleared.
   */
  endRunIfCurrent(generation: number): void {
    if (this.generation === generation) this.streaming = false
  }

  /**
   * The runtime is gone, and no backend reports its own teardown — Claude's SDK
   * iterator just reaches a clean EOF. Returns the events that tell every client
   * what it can no longer be doing; the caller forwards them, which also clears
   * this state through `apply`.
   */
  endRuntime(): AgentEvent[] {
    const events: AgentEvent[] = []
    if (this.realtime) events.push({ type: 'realtime_closed', reason: 'runtime_ended' })
    if (this.awaitingTurn) {
      // A send is rebuilding the runtime for its own turn, which reports the next
      // status. An idle here would end that turn's wait on every client.
      this.streaming = false
      this.settledStatus = 'idle'
    } else if (this.streaming || this.settledStatus !== 'idle') {
      events.push({ type: 'status_change', status: 'idle' })
    }
    return events
  }

  /** Disposal: nobody is left to tell. */
  reset(): void {
    this.streaming = false
    this.settledStatus = 'idle'
    this.realtime = false
    this.awaitingTurn = false
  }

  /**
   * The backend announced a run. Always a new generation, including when one was
   * already in flight — the interrupt this must outrank was issued against the
   * *previous* run, and that is exactly the case where the backend admits a
   * queued turn before it acks the stop.
   */
  private openRun(): void {
    this.generation += 1
    this.streaming = true
    // A new run supersedes whatever the last one settled on; its own terminal
    // `status_change` reports the next one.
    this.settledStatus = 'idle'
    this.awaitingTurn = false
  }
}
