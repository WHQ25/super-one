import type { CodexPromptSampleTrigger } from './prompt-sample'

/** Session-owned adapter: prediction results may arrive after a turn has settled. */
export interface CodexPromptPrediction {
  /** Observe turn boundaries; return true only for consumed prediction notifications. */
  observe(notification: { method: string; params: Record<string, unknown> }): boolean
  /** Invalidate the previous result before submitting another full turn. */
  invalidate(): void
  /**
   * Sample a finished turn this process did not see complete.
   * The same turn, and any turn still running, are left alone.
   */
  catchUp(threadId: string, turnId: string): void
}

export function createCodexPromptPrediction(options: {
  getThreadId: () => string | null
  onSuggestion: (suggestion: string) => void
  /** One-shot generator. Omitted hosts keep the notification receiver only. */
  sample?: (
    threadId: string,
    turnId: string,
    signal: AbortSignal,
    trigger: CodexPromptSampleTrigger,
  ) => Promise<string | null | undefined>
  /** Plan mode and custom model providers stay on the notification receiver. */
  canSample?: () => boolean
}): CodexPromptPrediction {
  let source: { threadId: string; turnId: string; completed: boolean } | null = null
  let suggestion: string | null = null
  let generation = 0
  let sampleAbort: AbortController | null = null

  const update = (text: string | null): void => {
    if (suggestion === text) return
    suggestion = text
    // The shared event uses an empty suggestion to clear both composer surfaces.
    options.onSuggestion(text ?? '')
  }
  const stopSample = (): void => {
    sampleAbort?.abort()
    sampleAbort = null
  }
  const invalidate = (): void => {
    generation += 1
    stopSample()
    source = null
    update(null)
  }
  const beginSample = (threadId: string, turnId: string, trigger: CodexPromptSampleTrigger): void => {
    if (!options.sample || options.canSample?.() === false) return
    stopSample()
    const token = generation
    const controller = new AbortController()
    sampleAbort = controller
    void Promise.resolve()
      .then(() => options.sample!(threadId, turnId, controller.signal, trigger))
      .then(next => {
        if (token !== generation || controller.signal.aborted) return
        if (source?.threadId !== threadId || source.turnId !== turnId || !source.completed) return
        if (next === undefined) return
        update(next)
      }, () => undefined)
  }

  return {
    invalidate,
    catchUp(threadId, turnId) {
      if (!options.sample || options.canSample?.() === false) return
      if (!threadId || !turnId || threadId !== options.getThreadId()) return
      if (source?.threadId === threadId && source.turnId === turnId) return
      if (source && !source.completed) return
      source = { threadId, turnId, completed: true }
      beginSample(threadId, turnId, 'catch_up')
    },
    observe: ({ method, params }) => {
      const isPrediction = method === 'thread/prediction/updated'
      const threadId = params.threadId
      if (typeof threadId !== 'string' || threadId !== options.getThreadId()) return isPrediction

      if (method === 'turn/started') {
        const turn = asRecord(params.turn)
        invalidate()
        if (typeof turn?.id === 'string' && turn.id.length > 0) {
          source = { threadId, turnId: turn.id, completed: false }
        }
      } else if (method === 'turn/completed') {
        const turn = asRecord(params.turn)
        if (source?.threadId === threadId && turn?.id === source.turnId) {
          source.completed = turn.status === 'completed'
          if (!source.completed) invalidate()
          else beginSample(threadId, source.turnId, 'turn_completed')
        }
      } else if (method === 'thread/compacted') {
        invalidate()
      } else if (isPrediction && source?.completed && source.threadId === threadId && params.sourceTurnId === source.turnId) {
        const result = asRecord(params.result)
        if (result?.type === 'failed' || (result?.type === 'completed' && result.text === null)) {
          update(null)
        } else if (result?.type === 'completed' && typeof result.text === 'string') {
          update(result.text.trim() || null)
        }
      }
      return isPrediction
    },
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
