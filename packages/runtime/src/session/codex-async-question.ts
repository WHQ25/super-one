import type { ChatMessage } from '@superone/shared/agent-types'
import { codexAsyncAnswerId, codexAsyncQuestionItems, codexAsyncReplyText, formatCodexAsyncQuestionReply } from '@superone/shared/codex-async-question'
import { anchorAsyncAnswer } from '@superone/shared/transcript-boundary'
import type { NodeSessionRecord } from './types'

const pending = new WeakMap<NodeSessionRecord, Map<string, Promise<{ reply: string }>>>()

/** A node keeps the same answer identity as desktop, including retries after a lost ACK. */
export async function answerNodeAsyncQuestion(
  session: NodeSessionRecord,
  messages: ChatMessage[],
  command: { messageId?: unknown; itemId?: unknown; answers?: unknown },
  deliver: (message: ChatMessage, text: string) => Promise<void>,
): Promise<{ reply: string }> {
  if (session.harnessId !== 'codex') throw Object.assign(new Error('Async questions require a Codex session'), { code: 'unsupported' })
  // An accepted answer outlives a still-streaming question's ephemeral delta.
  const savedId = typeof command.itemId === 'string' ? codexAsyncAnswerId(command.itemId) : null
  const saved = codexAsyncReplyText(messages.find(message => message.id === savedId && message.role === 'user'))
  if (saved !== null) return { reply: saved }
  const message = messages.find(message => message.id === command.messageId && message.role === 'assistant')
  const item = message ? codexAsyncQuestionItems(message).find(item => item.id === command.itemId) : undefined
  if (!item?.questions?.length) throw Object.assign(new Error('Async question not found'), { code: 'not_found' })
  if (!Array.isArray(command.answers) || command.answers.length !== item.questions.length
    || command.answers.some(answer => typeof answer !== 'string' || !answer.trim())) {
    throw Object.assign(new Error('Every question requires an answer'), { code: 'invalid_argument' })
  }
  const replyId = codexAsyncAnswerId(item.id)
  let requests = pending.get(session)
  if (!requests) { requests = new Map(); pending.set(session, requests) }
  const existing = requests.get(replyId)
  if (existing) return existing
  const reply = formatCodexAsyncQuestionReply(item.questions, command.answers)
  // Capture before the provider can emit continuation while accepting the input.
  const answer = anchorAsyncAnswer({ id: replyId, role: 'user', status: 'complete',
    content: [{ type: 'text', text: reply, codexAsyncQuestions: item.questions }],
    createdAt: new Date().toISOString(), providerId: 'codex' }, messages)
  const request = deliver(answer, reply).then(() => ({ reply }))
  requests.set(replyId, request)
  try { return await request } finally { requests.delete(replyId) }
}
