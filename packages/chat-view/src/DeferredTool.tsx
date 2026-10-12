import { useState } from 'react'
import { PortableToolRow, type PortableToolRowProps } from './PortableToolRow'
import { useDeferredToolDetail } from './use-deferred-tool-detail'
export { useDeferredToolDetail, DeferredDetailStatus, type DeferredToolDetail } from './use-deferred-tool-detail'

export function DeferredTool({ remoteDetail, ...props }: PortableToolRowProps & { remoteDetail: string }) {
  const [expanded, setExpanded] = useState(false)
  const { detail, status, retry } = useDeferredToolDetail(remoteDetail, expanded, props.status !== 'streaming', props.toolUseId)
  return <PortableToolRow {...props} {...detail} autoExpand={false} hasDeferredDetails
    detailStatus={status} onExpandedChange={setExpanded} onDetailRetry={retry} />
}
