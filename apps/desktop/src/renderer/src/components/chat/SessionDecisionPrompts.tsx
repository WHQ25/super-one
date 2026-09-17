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
      <AskUserQuestionPrompt />
    </>
  )
}
