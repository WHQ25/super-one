/** Session-owned adapter: prediction results may arrive after a turn has settled. */
export interface CodexPromptPrediction {
  /** Observe turn boundaries; return true only for consumed prediction notifications. */
  observe(notification: { method: string; params: Record<string, unknown> }): boolean
  /** Invalidate the previous result before submitting another full turn. */
  invalidate(): void
}

export function createCodexPromptPrediction(options: {
  getThreadId: () => string | null
  onSuggestion: (suggestion: string) => void
}): CodexPromptPrediction {
  let source: { threadId: string; turnId: string; completed: boolean } | null = null
  let suggestion: string | null = null

  const update = (text: string | null): void => {
    if (suggestion === text) return
    suggestion = text
    // The shared event uses an empty suggestion to clear both composer surfaces.
    options.onSuggestion(text ?? '')
  }
  const invalidate = (): void => {
    source = null
    update(null)
  }

  return {
    invalidate,
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
