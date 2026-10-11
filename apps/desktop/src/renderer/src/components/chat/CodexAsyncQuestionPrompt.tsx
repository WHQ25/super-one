import { useMemo } from 'react'
import { AskUserQuestionForm } from '@superone/chat-view/presenters/AskUserQuestionForm'
import { CODEX_ASYNC_QUESTION_DISMISSED, formatCodexAsyncQuestionReply, type PendingCodexAsyncQuestion } from '@superone/shared/codex-async-question'
import { buildDecisionQueue } from './composer-slot/decision-queue'
import { useActiveSession, useChatStore, useIsRemoteLocked, useSessionScope } from '@/stores/chat'
import { steerAsyncQuestionAnswer } from './codex-async-question-answer'
import { isFocusInChat, useChatRootRef } from './is-focus-in-chat'
import { shouldSuppressDecisionShortcut } from './composer-slot/decision-composer-policy'
import { QuestionPreviewContent } from './tool-result-views'

export function CodexAsyncQuestionPrompt({ question }: { question: PendingCodexAsyncQuestion }) {
  const scope = useSessionScope()
  const projectPath = useChatStore(state => scope?.projectPath ?? state.activeProject)
  const sessionId = useActiveSession(session => scope?.sessionId ?? session._activeSessionId)
  const liveId = useActiveSession(session => buildDecisionQueue(session.pendingPermissions, session.pendingQuestion, session.messages, session.pendingAsyncQuestions)[0]?.request.requestId)
  const remoteLocked = useIsRemoteLocked()
  const chatRootRef = useChatRootRef()
  const { request, item } = question
  const keyboard = useMemo(() => ({
    inScope: (event?: KeyboardEvent) => !remoteLocked && request.requestId === liveId
      && isFocusInChat(document.activeElement, chatRootRef?.current)
      && !(event && shouldSuppressDecisionShortcut(event, chatRootRef?.current)),
    mac: window.app?.platform === 'darwin',
  }), [chatRootRef, liveId, remoteLocked, request.requestId])
  const respond = async (answers: string[]) => {
    if (remoteLocked || request.requestId !== liveId || !projectPath || !sessionId) throw new Error('Session is not available for answers')
    await steerAsyncQuestionAnswer({ projectPath, sessionId }, request.requestId, formatCodexAsyncQuestionReply(item.questions ?? [], answers), item.questions)
  }
  return (
    <fieldset disabled={remoteLocked} className="mx-3 mb-1 min-w-0" inert={remoteLocked}>
      <AskUserQuestionForm key={`${projectPath}:${sessionId}:${item.id}`} request={request} keyboard={keyboard}
        renderPreview={props => <QuestionPreviewContent {...props} />}
        onSubmit={answers => respond(request.questions.map(q => answers[q.id!] ?? ''))}
        onDismiss={() => respond(request.questions.map(() => CODEX_ASYNC_QUESTION_DISMISSED))} />
    </fieldset>
  )
}
