import type { AgentEvent, ContentBlock, MessageMetadata } from '@superone/shared/agent-types'
import { applyContentDelta } from '@superone/shared/content-delta'
import type { TurnRunner } from '@superone/runtime/session'
import { OpenCodeV2TurnTranslator, openCodeV2FormAnswer } from './opencode-v2-event-map'
import type { OpenCodeV2Client } from './opencode-v2-client'
import { answerOpenCodeForm } from './form-controller'
import type { OpenCodeV2Event, OpenCodeV2Form } from './opencode-v2-types'

/** Node owns durable, leased interaction waiters; the translator owns content. */
export class NodeOpenCodeV2Events {
  private content: ContentBlock[] = []
  private metadata: MessageMetadata | undefined
  private contextTokens = 0
  private terminal = false
  private completed = false
  // Replayed pending requests must not ask again after their waiter has settled.
  private readonly seenInteractions = new Set<string>()
  private readonly resolvedInteractions = new Set<string>()
  private readonly translator: OpenCodeV2TurnTranslator
  constructor(
    private readonly input: Parameters<TurnRunner>[0],
    private readonly client: OpenCodeV2Client,
    private readonly sessionId: string,
    private readonly signal: AbortSignal,
    private readonly settle: (error?: Error) => void,
    contextWindow: (model: string) => number | undefined,
    private readonly replies?: {
      questionReply(id: string, answers: string[][]): Promise<void>
      questionReject(id: string): Promise<void>
      permissionReply(id: string, decision: 'once' | 'reject'): Promise<void>
      holdCompletion?(interrupted: boolean): boolean
      onInputAdmitted?(): void
    },
  ) {
    this.translator = new OpenCodeV2TurnTranslator({ contextWindow })
  }
  get text() {
    return this.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('')
  }
  get succeeded() {
    return this.completed
  }
  get ended() { return this.terminal }
  get messageId() { return this.input.messageId ?? `opencode-${this.sessionId}` }
  adoptInbox(id: string) { this.translator.adoptInbox(id) }
  emit(event: AgentEvent) {
    const previous = this.text
    if (event.type === 'content_delta')
      this.content = applyContentDelta(this.content, event.delta, Date.now, {
        replace: event.replace,
      })
    if (this.input.onAgentEvent) this.input.onAgentEvent(event)
    else if (event.type === 'content_delta' && event.delta.type === 'text' && this.text.startsWith(previous))
      this.input.onDelta(this.text.slice(previous.length))
    else if (event.type === 'status_change')
      this.input.onEvent?.({
        kind: 'status',
        status: event.status === 'streaming' ? 'streaming' : 'idle',
      })
  }
  finish(error?: Error, interrupted = false) {
    if (this.terminal) return
    this.terminal = true
    this.completed = !error && !interrupted
    const messageId = this.input.messageId ?? `opencode-${this.sessionId}`
    this.emit(
      error
        ? { type: 'message_error', messageId, error: error.message }
        : {
            type: interrupted ? 'message_interrupted' : 'message_complete',
            messageId,
            ...(this.metadata ? { metadata: this.metadata } : {}),
          },
    )
    this.emit({ type: 'status_change', status: error ? 'error' : 'idle' })
    this.settle(error)
  }
  private interact(id: string, operation: () => Promise<void>) {
    if (this.seenInteractions.has(id) || this.terminal) return
    this.seenInteractions.add(id)
    void operation().catch((error: unknown) => {
      if (!this.signal.aborted) this.finish(error instanceof Error ? error : new Error(String(error)))
    })
  }
  resolveInteractions(permissions: string[], forms: string[]) {
    for (const [ids, interactionType] of [
      [permissions, 'permission'],
      [forms, 'question'],
    ] as const)
      for (const requestId of ids) {
        this.resolvedInteractions.add(requestId)
        this.emit({ type: 'interaction_resolved', requestId, interactionType })
      }
  }
  apply(event: OpenCodeV2Event, replay = false) {
    if (this.terminal || this.signal.aborted) return
    for (const action of this.translator.apply(event, this.input.messageId ?? `opencode-${this.sessionId}`, replay)) {
      if (action.type === 'agent') {
        // A foreign native enqueue without our client id must not overwrite
        // this turn's user checkpoint. Explicit inbox adoption supplies it.
        if (action.event.type === 'checkpoint_captured' && this.input.clientMessageId && !action.event.userMessageId) continue
        if (action.event.type === 'checkpoint_captured' && this.input.clientMessageId && action.event.userMessageId === this.input.clientMessageId)
          this.replies?.onInputAdmitted?.()
        this.emit(action.event)
      }
      else if (action.type === 'step_ended') {
        this.metadata = action.metadata
        this.contextTokens = action.contextTokens
      } else if (action.type === 'complete') {
        if (!this.replies?.holdCompletion?.(action.interrupted)) this.finish(undefined, action.interrupted)
      }
      else if (action.type === 'fail') this.finish(new Error(action.error))
      else if (action.type === 'permission') {
        const request = action.request
        this.interact(request.requestId, async () => {
          const decision = await this.input.onPermission?.({
            interactionId: request.requestId,
            kind: 'permission',
            toolName: request.toolName,
            toolUseId: request.toolUseId,
            input: action.toolInput ?? request.input,
            message: request.message,
            permissionDetails: request.permissionDetails,
            // The node waiter supports once/reject, not native saved patterns.
            allowAlwaysAllow: false,
            createdAt: Date.now(),
          })
          this.signal.throwIfAborted()
          if (this.resolvedInteractions.has(request.requestId)) return
          const reply = decision === 'allow' ? 'once' : 'reject'
          if (this.replies) await this.replies.permissionReply(request.requestId, reply)
          else await this.client.permissionReply(this.sessionId, request.requestId, reply)
        })
      } else if (action.type === 'question' && event.type === 'form.created') this.question(event.data.form)
      else if (action.type === 'permission_resolved' || action.type === 'question_resolved')
        this.resolveInteractions(
          action.type === 'permission_resolved' ? [action.requestId] : [],
          action.type === 'question_resolved' ? [action.requestId] : [],
        )
      else if (action.type === 'compaction_started') this.emit({ type: 'status_indicator', indicator: 'compacting' })
      else if (action.type === 'compacted') {
        this.emit({
          type: 'compact_boundary',
          trigger: action.trigger,
          preTokens: this.contextTokens,
        })
        this.emit({
          type: 'status_indicator',
          indicator: null,
          compactResult: 'success',
        })
      } else if (action.type === 'compaction_failed')
        this.emit({
          type: 'status_indicator',
          indicator: null,
          compactResult: 'failed',
          compactError: action.error,
        })
    }
  }
  private question(form: OpenCodeV2Form) {
    this.interact(form.id, async () => {
      if (!this.input.onQuestion) {
        await this.client.formCancel(this.sessionId, form.id)
        throw new Error('This native OpenCode form requires an available controller')
      }
      const answers = await answerOpenCodeForm(form, this.input.onQuestion)
      this.signal.throwIfAborted()
      if (this.resolvedInteractions.has(form.id)) return
      if (!answers) {
        if (this.replies) await this.replies.questionReject(form.id)
        else await this.client.formCancel(this.sessionId, form.id)
        return
      }
      if (this.replies) await this.replies.questionReply(form.id, answers)
      else await this.client.formReply(this.sessionId, form.id, openCodeV2FormAnswer(form, answers))
    })
  }
}
