import type { ChatMessage, CodexAsyncUserInputQuestion } from './agent-types'

export const codexAsyncAnswerId = (itemId: string): string => `codex_async_answer:${itemId}`

/** Persist replies for restore and cross-device sync, but render them in the question card. */
export function isCodexAsyncAnswer(message: Pick<ChatMessage, 'id' | 'role'>): boolean {
  return message.role === 'user' && message.id.startsWith('codex_async_answer:')
}

export function codexAsyncReplyText(message: ChatMessage | undefined): string | null {
  return message?.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n') ?? null
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

export type CodexAsyncQuestionAnswerCommand = {
  type: 'codex_async_question_answer'
  requestId: string
  projectPath: string
  sessionId: string
  messageId: string
  itemId: string
  answers: string[]
}
