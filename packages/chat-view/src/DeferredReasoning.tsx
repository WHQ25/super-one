import { useTranslation } from 'react-i18next'
import { useState } from 'react'
import { useDeferredText } from './use-deferred-text'
import { ReasoningBlock, type ReasoningBlockProps } from './presenters/ReasoningBlock'

type Props = ReasoningBlockProps & { remoteDetails?: string[] }
export function DeferredReasoning({ remoteDetails, ...props }: Props) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const { text, error, loading, retry } = useDeferredText(remoteDetails, expanded, props.blockDone)
  return <ReasoningBlock {...props} autoExpand={false} collapseOnDone={false}
    showContent={Boolean(remoteDetails?.length) || props.showContent}
    onExpandedChange={setExpanded} onRetry={error ? retry : undefined}
    text={remoteDetails?.length ? (error || (loading && !text ? t('common.loading') : text)) : props.text} />
}
