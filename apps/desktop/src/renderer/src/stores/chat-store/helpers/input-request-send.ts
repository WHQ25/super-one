import type { SchemaFormValue } from '@superone/shared/schema-form'
import { isInputRequest } from '@superone/shared/input-request-presentation'
import { inputRequestMessageText, parseInputRequestError } from '@superone/shared/input-request'
import { parseRemoteProjectKey } from '@superone/shared/remote-resource-key'
import { newMessageId } from '@superone/shared/message-id'
import type { ChatStore, SessionWriteTarget } from '../types'
import type { ChatStoreSet } from './lifecycle'
import { createLocalTextUserMessage, resolveSessionCodexSelection } from './codex-helpers'
import { commitPerSession, getProject, mergeCallerScopedDirs, resolveWriteScope } from './store-helpers'
import { resolveProvider } from './provider-routing'
import { deliverUserSend } from './send-replay'
import { sessionSendRequest, shouldQueueUserSend } from './session-send-request'
import { setInputRequestError } from './input-request-errors'
import { getInputRequestDraft, setInputRequestDraft } from './input-request-draft-cache'

/** Submit a widget form as a normal user message, keeping the unrelated chat draft intact. */
export async function sendInputRequestImpl(
  set: ChatStoreSet,
  get: () => ChatStore,
  requestId: string,
  values: Record<string, SchemaFormValue>,
  target?: SessionWriteTarget,
): Promise<boolean> {
  const { projectPath, sessionId, session } = resolveWriteScope(get(), target)
  const pending = session.pendingPermissions.find(request => request.requestId === requestId)
  if (!projectPath || !sessionId || parseRemoteProjectKey(projectPath)
    || !isInputRequest(pending) || pending.inputRequest.output !== 'agent' || !pending.schemaForm) return false
  const owner = { projectPath, sessionId }
  const draft = getInputRequestDraft(owner, requestId)
  setInputRequestError(owner, requestId)
  const content = inputRequestMessageText(pending.inputRequest, pending.schemaForm, values)
  const messageId = newMessageId('user')
  const provider = resolveProvider(session)
  const queued = shouldQueueUserSend(provider, session.status)
  const awaitsReply = !queued && ['claude', 'acp', 'cursor', 'opencode'].includes(provider)
  const codex = provider === 'codex'
    ? resolveSessionCodexSelection(getProject(get(), projectPath).codexModels, session.selectedCodexModel, session.selectedCodexReasoningEffort) : null
  const request = sessionSendRequest({
    session, sessionId, provider, content, clientMessageId: messageId,
    additionalDirs: mergeCallerScopedDirs(getProject(get(), projectPath), session),
    model: provider === 'codex' ? codex?.modelId || undefined : session.selectedModel || undefined,
    effort: session.selectedEffort,
    reasoningEffort: codex?.reasoningEffort,
    inputRequest: { requestId, values },
    userMessageContent: [{ type: 'text', text: content }],
    queued,
  })
  const patchSession = (updater: Parameters<typeof commitPerSession>[2]) => set(state => state.projectSessions[projectPath]?._sessions[sessionId]
    ? commitPerSession(state, owner, updater) : {})
  patchSession(current => ({
    ...(!queued ? { messages: [...current.messages, createLocalTextUserMessage(messageId, content)] }
      : { queuedMessages: [...current.queuedMessages, createLocalTextUserMessage(messageId, content)] }),
    // The failed-send bubble owns retries; it must not create a second submission.
    pendingPermissions: current.pendingPermissions.filter(item => item.requestId !== requestId),
    ...(awaitsReply ? { awaitingAssistantReply: true } : {}),
    ...(provider === 'cursor' && !queued ? { status: 'streaming' as const } : {}),
  }))
  await deliverUserSend({
    messageId,
    patchSession,
    deliver: () => window.agent.sendMessage(projectPath, request),
    onRejected: error => {
      const rejected = parseInputRequestError(error)
      if (rejected?.code !== 'invalid') return false
      if (!get().projectSessions[projectPath]?._sessions[sessionId]) return true
      setInputRequestDraft(owner, requestId, draft ?? { values, added: new Map(), stepIndex: 0, touched: new Set(Object.keys(values)) })
      patchSession(current => ({
        messages: current.messages.filter(message => message.id !== messageId),
        queuedMessages: current.queuedMessages.filter(message => message.id !== messageId),
        pendingPermissions: current.pendingPermissions.some(item => item.requestId === requestId)
          ? current.pendingPermissions : [...current.pendingPermissions, pending],
        ...(awaitsReply ? { awaitingAssistantReply: false } : {}),
      }))
      setInputRequestError(owner, requestId, rejected.message)
      return true
    },
    retryable: error => parseInputRequestError(error) === null,
    retryState: () => ({
      ...(awaitsReply ? { awaitingAssistantReply: true } : {}),
      ...(provider === 'cursor' && !queued ? { status: 'streaming' as const } : {}),
    }),
  })
  return true
}
