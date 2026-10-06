import { useMemo } from 'react'
import type { AskUserQuestionRequest } from '@superone/shared/agent-types'
import { AskUserQuestionForm } from '@superone/chat-view/presenters/AskUserQuestionForm'
import { useActiveSession, useScopedSessionActions } from '@/stores/chat'
import { QuestionPreviewContent } from './tool-result-views'
import { isFocusInChat, useChatRootRef } from './is-focus-in-chat'
import { shouldSuppressDecisionShortcut } from './composer-slot/decision-composer-policy'

/**
 * The active session's pending question, with the desktop's keyboard shortcuts.
 * `ChatContent` restores the base composer's focus after the decision queue clears.
 */
export function AskUserQuestionPrompt({ request }: { request?: AskUserQuestionRequest | null }) {
  const liveQuestion = useActiveSession((s) => s.pendingQuestion)
  const pendingQuestion = request === undefined ? liveQuestion : request
  const { answerQuestion, dismissQuestion } = useScopedSessionActions()
  const chatRootRef = useChatRootRef()
  // Digits typed into another panel (editor, terminal, a sibling tile) are not answers.
  const keyboard = useMemo(() => ({
    inScope: (event?: KeyboardEvent) => pendingQuestion?.requestId === liveQuestion?.requestId
      && isFocusInChat(document.activeElement, chatRootRef?.current)
      && !(event && shouldSuppressDecisionShortcut(event, chatRootRef?.current)),
    mac: window.app?.platform === 'darwin',
  }), [chatRootRef, pendingQuestion?.requestId, liveQuestion?.requestId])
  if (!pendingQuestion) return null
  const { requestId } = pendingQuestion
  return (
    <div className="mx-3 mb-1">
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
