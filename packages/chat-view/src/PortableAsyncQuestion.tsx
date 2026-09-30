import { createContext, useContext } from 'react'
import type { ChatMessage, CodexAgentMessageItem } from '@superone/shared/agent-types'
import { codexAsyncAnswerId, codexAsyncReplyText } from '@superone/shared/codex-async-question'
import { CodexAsyncQuestionForm } from './presenters/CodexAsyncQuestionForm'
import { requestNativeAsync } from './bridge'
import { TurnMessageIdContext } from './portable-turn-context'

export const AsyncQuestionMessagesContext = createContext<readonly ChatMessage[]>([])

export function PortableAsyncQuestion({ item }: { item: CodexAgentMessageItem }) {
  const messages = useContext(AsyncQuestionMessagesContext)
  const messageId = useContext(TurnMessageIdContext)
  const savedReply = messages.find(message => message.id === codexAsyncAnswerId(item.id))
  return <CodexAsyncQuestionForm key={`${messageId}:${item.id}`} questions={item.questions ?? []}
    submittedReply={codexAsyncReplyText(savedReply)} disabled={!messageId}
    onSubmit={async (answers) => {
      await requestNativeAsync('codexAsyncQuestionAnswer', { messageId, itemId: item.id, answers })
    }} />
}
