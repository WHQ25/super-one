import type { ProjectedRealtimeActivity } from '@superone/shared/realtime-transcript-projection'
import { requestNative } from './bridge'
import { RealtimeDelegationStatus } from './presenters/RealtimeDelegationStatus'

export function PortableRealtimeActivity({ row }: { row: ProjectedRealtimeActivity }) {
  return <div data-testid="realtime-delegation-row" data-activity-kind={row.activity.kind}
    data-activity-status={row.activity.status} className="@container mb-3 flex min-w-0 flex-col">
    <RealtimeDelegationStatus activity={row.activity} onOpen={() => {
      requestNative('openRealtimeThread', { messageId: row.activity.messageIds[0] })
    }} />
  </div>
}
