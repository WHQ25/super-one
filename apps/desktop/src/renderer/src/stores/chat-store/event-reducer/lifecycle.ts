import type { AgentEvent } from '@superone/shared/agent-types'
import { DEFAULT_PROVIDER } from '../index'
import type { PerSessionState } from '../types'

type LifecycleEvent = Extract<AgentEvent, {
  type:
    | 'queued_message_consumed'
    | 'message_start'
    | 'message_timestamp'
    | 'user_message_appended'
    | 'message_interrupted'
    | 'message_error'
    | 'status_change'
    | 'session_init'
    | 'provider_session_id'
    | 'init_ready'
    | 'worktree_missing'
}>

export function reduceLifecycle(session: PerSessionState, event: LifecycleEvent): Partial<PerSessionState> {
  switch (event.type) {
    case 'queued_message_consumed': {
      const idx = session.queuedMessages.findIndex((m) => m.id === event.clientMessageId)
      if (idx === -1) return {}
      const consumed = session.queuedMessages[idx]
      const alreadyInTranscript = session.messages.some((m) => m.id === consumed.id)
      return {
        ...(alreadyInTranscript ? {} : { messages: [...session.messages, consumed] }),
        queuedMessages: session.queuedMessages.filter((_, i) => i !== idx),
        awaitingAssistantReply: true,
        lastEventAt: Date.now(),
      }
    }

    case 'message_start': {
      const existingIdx = session.messages.findIndex((m) => m.id === event.message.id)
      const nextMessages = existingIdx === -1
        ? [...session.messages, event.message]
        : session.messages
      return {
        messages: nextMessages,
        promptSuggestion: null,
        awaitingAssistantReply: false,
        lastEventAt: Date.now(),
        ...(event.message.role === 'assistant'
          ? { lastAssistantMessageId: event.message.id, streamingTokens: { input: 0, output: 0 } }
          : {}),
      }
    }

    case 'message_timestamp': {
      let changed = false
      const messages = session.messages.map((msg) => {
        if (msg.id !== event.messageId || msg.createdAt === event.timestamp) return msg
        changed = true
        return { ...msg, createdAt: event.timestamp }
      })
      return changed ? { messages } : {}
    }

    case 'user_message_appended': {
      if (session.messages.some((m) => m.id === event.message.id)) return {}
      return {
        messages: [...session.messages, event.message],
        lastEventAt: Date.now(),
      }
    }

    case 'message_interrupted': {
      const ft = session.streamingTokens
      const consumedTokens = ft.input > 0 || ft.output > 0
        ? { input: ft.input, output: ft.output }
        : undefined
      return {
        messages: session.messages.map((msg) => {
          if (msg.id !== event.messageId) return msg
          const nextMeta = {
            ...msg.metadata,
            ...(event.metadata ?? {}),
            ...(consumedTokens ? { consumedTokens } : {}),
          }
          return {
            ...msg,
            status: 'interrupted' as const,
            metadata: nextMeta,
          }
        }),
        pendingPermissions: [],
        pendingQuestion: null,
        pendingPlanApproval: null,
        awaitingAssistantReply: false,
        lastEventAt: 0,
        streamingTokens: { input: 0, output: 0 },
      }
    }

    case 'message_error':
      return {
        awaitingAssistantReply: false,
        lastEventAt: 0,
        streamingTokens: { input: 0, output: 0 },
        messages: session.messages.map((msg) => {
          if (msg.id !== event.messageId) return msg
          // The failure lives in metadata, not in a text block: the footer badge
          // owns the summary and its popover owns the detail. Harnesses that send
          // no structured info still get a badge via the raw fallback.
          return {
            ...msg,
            status: 'error' as const,
            metadata: {
              ...msg.metadata,
              errorInfo: event.errorInfo ?? { raw: event.error },
            },
          }
        }),
      }

    case 'status_change':
      // Leave queuedMessages in place. Grok/OpenCode emit idle at the end of
      // the live turn *before* queued_message_consumed; splicing the queue in
      // here (especially before the last assistant) jumps the next user prompt
      // above the reply it is waiting on. Consume is the source of truth.
      return {
        status: event.status,
        ...(event.status === 'idle' ? { apiRetry: null, modelFallback: null } : {}),
      }

    case 'session_init':
      console.log('[applyEvent] session_init', { sessionId: event.session?.sessionId, outputStyle: event.session?.outputStyle, availableOutputStyles: event.session?.availableOutputStyles })
      return {
        session: event.session,
        _providerSessionId: event.session?.sessionId ?? session._providerSessionId,
        sessionProvider: session.sessionProvider ?? DEFAULT_PROVIDER,
      }

    case 'provider_session_id':
      return { _providerSessionId: event.providerSessionId }

    case 'init_ready':
      return { permissionMode: event.permissionMode }

    case 'worktree_missing':
      return { _worktreeRemoved: true, cwd: event.fallbackCwd }
  }
}
