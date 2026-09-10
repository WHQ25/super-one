import type { Session } from '../session/types'
import type { CodexAsyncQuestionAnswerCommand } from '@superone/shared/codex-async-question'
import { codexAsyncAnswerId, codexAsyncReplyText, formatCodexAsyncQuestionReply } from '@superone/shared/codex-async-question'

const pending = new WeakMap<Session, Map<string, Promise<string>>>()

/** Use the same durable side-channel reply as desktop, including retries after a lost ACK. */
export async function answerRemoteAsyncQuestion(session: Session | null | undefined, command: CodexAsyncQuestionAnswerCommand): Promise<string> {
  if (!session || session.snapshot.harnessId !== 'codex') throw new Error('No active Codex session')
  const message = session.snapshot.messages.find(message => message.id === command.messageId)
  const item = message?.metadata?.codex?.items.find(item => item.id === command.itemId)
  if (item?.type !== 'agent_message' || !item.questions?.length) throw new Error('Async question not found')
  if (!Array.isArray(command.answers) || command.answers.length !== item.questions.length
    || command.answers.some(answer => typeof answer !== 'string' || !answer.trim())) throw new Error('Every question requires an answer')
  const replyId = codexAsyncAnswerId(item.id)
  const saved = codexAsyncReplyText(session.snapshot.messages.find(message => message.id === replyId))
  if (saved !== null) return saved
  let requests = pending.get(session)
  if (!requests) { requests = new Map(); pending.set(session, requests) }
  const existing = requests.get(replyId)
  if (existing) return existing
  const reply = formatCodexAsyncQuestionReply(item.questions, command.answers)
  const request = session.dispatchBackendCommand({
    kind: 'codex.steer', input: reply, newAssistantMessageId: '', newUserMessageId: replyId, newUserText: reply,
    providerOrigin: 'remote',
  }).then(() => reply)
  requests.set(replyId, request)
  try { return await request } finally { requests.delete(replyId) }
}
