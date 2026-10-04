import { ModQuestionSite } from '@superone/chat-view/mod-ui'
import { useActiveSession } from '@/stores/chat'
import { useRestoreChatInputFocus } from '@/hooks/useRestoreChatInputFocus'
import { PermissionPrompt } from './PermissionPrompt'
import { AskUserQuestionPrompt } from './AskUserQuestionPrompt'

/**
 * The session-level decisions a running turn can block on. They belong to the
 * session, not to any transcript row, so every composer variant stacks the same set
 * above its input: whichever view is on screen is where the decision gets made.
 */
export function SessionDecisionPrompts() {
  return (
    <>
      <PermissionPrompt />
      <QuestionSite />
    </>
  )
}

function QuestionSite() {
  const question = useActiveSession((s) => s.pendingQuestion)
  // Here, not in the prompt: a mod wrapping it remounts the prompt.
  useRestoreChatInputFocus(!!question)
  if (!question) return null
  return (
    <ModQuestionSite request={question}>
      <AskUserQuestionPrompt />
    </ModQuestionSite>
  )
}
