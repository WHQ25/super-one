import { DeferredReasoning } from '@superone/chat-view/DeferredReasoning'
import { useAppStore } from '@/stores/app'
import {
  ReasoningBlock as ReasoningBlockView,
  type ReasoningBlockProps,
} from './presenters/ReasoningBlock'

export type { ReasoningBlockProps } from './presenters/ReasoningBlock'

function useReasoningAutoExpand(override: boolean | undefined): boolean {
  const autoExpandReasoning = useAppStore((state) => state.autoExpandReasoning)
  return override ?? autoExpandReasoning
}

/** Desktop reasoning row. `autoExpand` overrides Appearance → Auto-Expand Reasoning. */
export function ReasoningBlock(props: ReasoningBlockProps) {
  const autoExpand = useReasoningAutoExpand(props.autoExpand)
  return <ReasoningBlockView {...props} autoExpand={autoExpand} />
}

/**
 * The reasoning slot: summarized reasoning (`remoteDetails`) loads its text
 * when opened; full reasoning draws as it is.
 */
export function DesktopReasoning(props: ReasoningBlockProps & { remoteDetails?: string[] }) {
  const autoExpand = useReasoningAutoExpand(props.autoExpand)
  return props.remoteDetails?.length
    ? <DeferredReasoning {...props} autoExpand={autoExpand} />
    : <ReasoningBlockView {...props} autoExpand={autoExpand} />
}
