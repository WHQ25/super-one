import type { BackendCommand, Session, SessionBackend } from './types'
import type { ChatMessage } from '@superone/shared/agent-types'
import { isCodexAsyncAnswer } from '@superone/shared/codex-async-question'
import log from '../logger'

type SteerCommand = Extract<BackendCommand, {
  kind: 'codex.steer' | 'codex.steer_queued' | 'claude.steer_queued' | 'acp.steer_queued'
}>

type AnswerSession = Pick<Session, 'send' | 'on' | 'snapshot' | 'getSelectedModel' | 'getSelectedEffort'>

/** Only accepted steering input belongs in the durable user transcript. */
export async function dispatchBackendSteer(cmd: SteerCommand, host: {
  id: string
  harnessId: string
  streaming: boolean
  backend: SessionBackend
  session: AnswerSession
  appendUserMessage: (message: ChatMessage) => void
}): Promise<void> {
  const asyncAnswer = host.harnessId === 'codex' && cmd.kind === 'codex.steer' && cmd.newUserMessageId
    && isCodexAsyncAnswer({ id: cmd.newUserMessageId, role: 'user' })
  if (asyncAnswer) {
    if (host.session.snapshot.messages.some(message => message.id === cmd.newUserMessageId)) return
    if (!host.streaming) return sendAsyncAnswer(cmd, host.session)
  }
  if (cmd.kind !== 'codex.steer') {
    const [harness, label] = {
      'codex.steer_queued': ['codex', 'Codex'],
      'claude.steer_queued': ['claude', 'Claude'],
      'acp.steer_queued': ['acp', 'ACP'],
    }[cmd.kind]
    if (host.harnessId !== harness || !host.streaming) {
      throw new Error(`Queued message can only steer an active ${label} turn`)
    }
  }
  if (!host.backend.handleCommand) {
    throw new Error(`Session ${host.id} harness=${host.harnessId} does not support backend commands`)
  }
  try {
    await host.backend.handleCommand(cmd)
  } catch (error) {
    // Only this explicit rejection proves the input was not accepted. A timeout
    // or connection failure might have delivered it, so those remain retryable.
    if (asyncAnswer && error instanceof Error && error.message === 'No active Codex turn to steer') {
      return sendAsyncAnswer(cmd, host.session)
    }
    throw error
  }
  if (cmd.kind === 'codex.steer' && cmd.newUserMessageId && cmd.newUserText) {
    host.appendUserMessage({
      id: cmd.newUserMessageId,
      role: 'user',
      status: 'complete',
      content: [{ type: 'text', text: cmd.newUserText }],
      createdAt: new Date().toISOString(),
      providerId: host.harnessId,
    })
  }
}

/** A normal send lasts the whole turn; the answer RPC acknowledges durable input. */
function sendAsyncAnswer(
  cmd: Extract<SteerCommand, { kind: 'codex.steer' }>,
  session: AnswerSession,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let accepted = false
    const unsubscribe = session.on(event => {
      if (event.type !== 'user_message_appended' || event.message.id !== cmd.newUserMessageId) return
      accepted = true
      unsubscribe()
      resolve()
    })
    void session.send({
      content: cmd.input,
      clientMessageId: cmd.newUserMessageId,
      model: session.getSelectedModel(),
      effort: session.getSelectedEffort(),
      ...(cmd.newUserText ? { userMessageContent: [{ type: 'text', text: cmd.newUserText }] } : {}),
    }, { providerOrigin: cmd.providerOrigin ?? 'local' }).then(() => {
      unsubscribe()
      resolve()
    }, error => {
      unsubscribe()
      if (accepted) log.warn('[Session] async answer turn failed:', error)
      else reject(error)
    })
  })
}
