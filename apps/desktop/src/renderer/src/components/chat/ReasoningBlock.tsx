import { DeferredReasoning } from '@superone/chat-view/DeferredReasoning'
import { ReasoningBlock, type ReasoningBlockProps } from './presenters/ReasoningBlock'

export * from './presenters/ReasoningBlock'

/**
 * The reasoning slot: summarized reasoning (`remoteDetails`) loads its text
 * when opened; full reasoning draws as it is.
 */
export function DesktopReasoning(props: ReasoningBlockProps & { remoteDetails?: string[] }) {
  return props.remoteDetails?.length ? <DeferredReasoning {...props} /> : <ReasoningBlock {...props} />
}
