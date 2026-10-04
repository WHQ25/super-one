import { useMemo, type ReactNode } from 'react'
import type { AskUserQuestionRequest } from '@superone/shared/agent-types'
import { ModSite } from './react'
import { askUserQuestionProps, commandOutputProps, stringProp } from './site-props'

/**
 * A mod may draw around the question prompt. SuperOne always draws the
 * original questions: the answers are keyed by them, so the tree must hold
 * exactly one engine ref.
 */
export function ModQuestionSite({ request, children }: { request: AskUserQuestionRequest; children: ReactNode }) {
  const props = useMemo(() => askUserQuestionProps(request.questions), [request.questions])
  return (
    <ModSite component="AskUserQuestion" instanceId={request.requestId} props={props} engineOnce>
      {() => children}
    </ModSite>
  )
}

/** A mod may draw around, or rewrite the text of, a slash command's output. */
export function ModCommandOutputSite({ command, content, children }: {
  command: string
  content: string
  children: (text: string) => ReactNode
}) {
  const props = useMemo(() => commandOutputProps(command, '', content, false), [command, content])
  return (
    <ModSite component="CommandOutput" instanceId={`command:${command}`} props={props}>
      {(p) => children(stringProp(p, 'text', content))}
    </ModSite>
  )
}
