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

export type CodexAsyncQuestionAnswerCommand = {
  type: 'codex_async_question_answer'
  requestId: string
  projectPath: string
  sessionId: string
  messageId: string
  itemId: string
  answers: string[]
}
