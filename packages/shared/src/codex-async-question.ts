import type { AskUserQuestionRequest, ChatMessage, CodexAgentMessageItem, CodexAsyncUserInputQuestion, ContentBlock } from './agent-types'
import { readableContent } from './codex-content'

export const codexAsyncAnswerId = (itemId: string): string => `codex_async_answer:${itemId}`

/** Durable reply identity, shared by steering, the decision queue and user bubbles. */
export function isCodexAsyncAnswer(message: Pick<ChatMessage, 'id' | 'role'>): boolean {
  return message.role === 'user' && message.id.startsWith('codex_async_answer:')
}

export function codexAsyncReplyText(message: ChatMessage | undefined): string | null {
  return message?.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n') ?? null
}

export const CODEX_ASYNC_QUESTION_DISMISSED = '[The user dismissed this question.]'

/** Keep accepted cancellation notices durable, but out of the visible user transcript. */
export function isDismissedCodexAsyncAnswer(message: ChatMessage, messages: readonly ChatMessage[] = []): boolean {
  if (!isCodexAsyncAnswer(message)) return false
  const reply = codexAsyncReplyText(message)?.trim()
  if (reply === CODEX_ASYNC_QUESTION_DISMISSED) return true
  if (!reply) return false
  const questions = codexAsyncAnswerQuestions(message, messages)
  return !!questions?.length
    && reply === formatCodexAsyncQuestionReply(questions, questions.map(() => CODEX_ASYNC_QUESTION_DISMISSED)).trim()
}

export interface PendingCodexAsyncQuestion {
  messageId: string
  item: CodexAgentMessageItem
  request: AskUserQuestionRequest
}

export function codexAsyncQuestionRequest(item: CodexAgentMessageItem): AskUserQuestionRequest {
  return {
    requestId: codexAsyncAnswerId(item.id),
    questions: (item.questions ?? []).map((question, index) => ({
      id: String(index), question: question.title, header: question.title, multiSelect: false,
      options: (question.options ?? []).map(label => ({ label, description: '' })),
    })),
  }
}

/**
 * The async questions a turn asked: its own (not a subagent's) text blocks that
 * carry them, in the item shape the decision queue and its wire protocol use.
 */
export function codexAsyncQuestionItems(message: Parameters<typeof readableContent>[0]): CodexAgentMessageItem[] {
  return readableContent(message).flatMap(block => block.type === 'text' && block.id && !block.parentToolUseId && block.codexAsyncQuestions?.length
    ? [{ id: block.id, type: 'agent_message' as const, text: block.text, delivery: 'async' as const, questions: block.codexAsyncQuestions }]
    : [])
}

/** Transcript order survives restore; accepted replies alone remove requests from the queue. */
export function pendingCodexAsyncQuestions(messages: readonly ChatMessage[]): PendingCodexAsyncQuestion[] {
  const answered = new Set(messages.filter(isCodexAsyncAnswer).map(message => message.id))
  const seen = new Set<string>()
  const pending: PendingCodexAsyncQuestion[] = []
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    for (const item of codexAsyncQuestionItems(message)) {
      if (seen.has(item.id)) continue
      seen.add(item.id)
      if (!answered.has(codexAsyncAnswerId(item.id))) pending.push({ messageId: message.id, item, request: codexAsyncQuestionRequest(item) })
    }
  }
  return pending
}

/** A host snapshot's queue remains authoritative while the transcript pages around it. */
export function codexAsyncQuestionQueue(session: { messages: readonly ChatMessage[]; pendingAsyncQuestions?: PendingCodexAsyncQuestion[] | null }): PendingCodexAsyncQuestion[] {
  const pending = session.pendingAsyncQuestions ?? pendingCodexAsyncQuestions(session.messages)
  const answered = new Set(session.messages.filter(isCodexAsyncAnswer).map(message => message.id))
  return pending.some(q => answered.has(q.request.requestId)) ? pending.filter(q => !answered.has(q.request.requestId)) : pending
}

/** Legacy replies can still recover the question from a loaded source turn. */
export function codexAsyncAnswerQuestions(message: ChatMessage, messages: readonly ChatMessage[]): CodexAsyncUserInputQuestion[] | undefined {
  if (!isCodexAsyncAnswer(message)) return undefined
  const stored = message.content.find(block => block.type === 'text' && block.codexAsyncQuestions?.length)
  if (stored?.type === 'text') return stored.codexAsyncQuestions
  const itemId = message.id.slice('codex_async_answer:'.length)
  for (const source of messages) {
    const item = source.role === 'assistant' ? codexAsyncQuestionItems(source).find(item => item.id === itemId) : undefined
    if (item) return item.questions
  }
  return undefined
}

export function codexAsyncAnswerContent(replyId: string, reply: string, messages: readonly ChatMessage[]): ContentBlock[] {
  const questions = codexAsyncAnswerQuestions({ id: replyId, role: 'user', status: 'complete', providerId: 'codex', content: [], createdAt: '' }, messages)
  return [{ type: 'text', text: reply, ...(questions?.length ? { codexAsyncQuestions: questions } : {}) }]
}

export function codexAsyncAnswerCopyText(questions: CodexAsyncUserInputQuestion[], reply: string): string {
  const answers = parseCodexAsyncQuestionReply(questions, reply)
  return answers ? questions.map((q, index) => `${q.title}\n${answers[index]}`).join('\n\n') : `${questions.map(q => q.title).join('\n\n')}\n\n${reply}`
}

export function formatCodexAsyncQuestionReply(questions: CodexAsyncUserInputQuestion[], answers: string[]): string {
  if (questions.length === 1) return answers[0]?.trim() ?? ''
  return questions.map((question, index) => `${question.title}\n${answers[index]?.trim() ?? ''}`).join('\n\n')
}

/** Recover display pairs from saved replies; preserve the original text if boundaries are ambiguous. */
export function parseCodexAsyncQuestionReply(questions: CodexAsyncUserInputQuestion[], reply: string): string[] | null {
  if (questions.length === 1) return [reply]
  if (questions.length === 0 || !reply.startsWith(`${questions[0].title}\n`)) return null

  const answers: string[] = []
  let start = questions[0].title.length + 1
  for (let index = 1; index < questions.length; index++) {
    const separator = `\n\n${questions[index].title}\n`
    const end = reply.indexOf(separator, start)
    if (end < 0 || reply.indexOf(separator, end + separator.length) >= 0) return null
    answers.push(reply.slice(start, end))
    start = end + separator.length
  }
  answers.push(reply.slice(start))
  return answers
}
