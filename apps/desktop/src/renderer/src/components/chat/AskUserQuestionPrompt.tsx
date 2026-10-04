import { useMemo } from 'react'
import { AskUserQuestionForm } from '@superone/chat-view/presenters/AskUserQuestionForm'
import { useActiveSession, useScopedSessionActions } from '@/stores/chat'
import { QuestionPreviewContent } from './tool-result-views'
import { isFocusInChat, useChatRootRef } from './is-focus-in-chat'

/**
 * The active session's pending question, with the desktop's keyboard shortcuts.
 * `SessionDecisionPrompts` restores the composer's focus once it is answered.
 */
export function AskUserQuestionPrompt() {
  const pendingQuestion = useActiveSession((s) => s.pendingQuestion)
  const { answerQuestion, dismissQuestion } = useScopedSessionActions()
  const chatRootRef = useChatRootRef()
  // Digits typed into another panel (editor, terminal, a sibling tile) are not answers.
  const keyboard = useMemo(() => ({ inScope: () => isFocusInChat(document.activeElement, chatRootRef?.current) }), [chatRootRef])
  if (!pendingQuestion) return null
  const { requestId } = pendingQuestion
  return (
    <div className="mx-3 mb-2">
      <AskUserQuestionForm
        key={requestId}
        request={pendingQuestion}
        onSubmit={(answers, annotations) => answerQuestion(requestId, answers, annotations)}
        onDismiss={() => dismissQuestion(requestId)}
        renderPreview={(props) => <QuestionPreviewContent {...props} />}
        keyboard={keyboard}
      />
    </div>
  )
}
