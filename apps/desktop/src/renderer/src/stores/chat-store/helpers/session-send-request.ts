import type { SendMessageRequest } from '@superone/shared/agent-types'
import type { ChatProvider, PerSessionState } from '../types'

interface SessionSendOptions {
  session: PerSessionState
  sessionId: SendMessageRequest['sessionId']
  provider: ChatProvider
  content: string
  clientMessageId: string
  additionalDirs: string[]
  model?: SendMessageRequest['model']
  effort?: SendMessageRequest['effort']
  reasoningEffort?: NonNullable<SendMessageRequest['codex']>['reasoningEffort']
  images?: SendMessageRequest['images']
  userMessageContent?: SendMessageRequest['userMessageContent']
  contexts?: SendMessageRequest['contexts']
  userSelections?: SendMessageRequest['userSelections']
  queued?: boolean
  inputRequest?: SendMessageRequest['inputRequest']
}

export function shouldQueueUserSend(provider: ChatProvider, status: PerSessionState['status'], codexRun = true): boolean {
  return status === 'streaming' && (provider === 'claude' || provider === 'acp'
    || provider === 'opencode' || provider === 'dsh' || (provider === 'codex' && codexRun))
}

/** Ordinary chat and widget forms carry the same session settings to the host. */
export function sessionSendRequest(options: SessionSendOptions): SendMessageRequest {
  const { session, sessionId, provider, content, clientMessageId } = options
  return {
    content,
    clientMessageId,
    sessionId,
    provider,
    model: options.model,
    effort: provider === 'codex' ? undefined : options.effort,
    additionalDirs: options.additionalDirs,
    images: options.images,
    userMessageContent: options.userMessageContent,
    contexts: options.contexts,
    userSelections: options.userSelections,
    gitBranch: session._gitBranch ?? undefined,
    worktreePath: session._worktreePath ?? undefined,
    ...(provider === 'opencode' && session.openCodeAgentId ? { agent: session.openCodeAgentId } : {}),
    ...(provider === 'codex' ? { codex: {
      mode: 'run',
      prompt: content,
      reasoningEffort: options.reasoningEffort,
      permissionPreset: session.selectedCodexPermissionPreset,
      collaborationMode: session.selectedCodexCollaborationMode,
      ...(session._providerSessionId ? { threadId: session._providerSessionId } : {}),
      ...(session.cwd ? { cwd: session.cwd } : {}),
    } } : {}),
    ...(session.apiProviderId ? { apiProviderId: session.apiProviderId } : {}),
    ...(provider === 'acp' && session.acpAgentId ? { acpAgentId: session.acpAgentId } : {}),
    ...(provider === 'cursor' ? { cursor: { params: session.cursorModelParams ?? {} } } : {}),
    ...(options.queued ? { priority: 'next' } : {}),
    ...(options.inputRequest ? { inputRequest: options.inputRequest } : {}),
  }
}
