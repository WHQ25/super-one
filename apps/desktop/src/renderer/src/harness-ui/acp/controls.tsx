import { AcpModeSelector } from '@/components/chat/AcpModeSelector'
import { AcpPermissionSelector } from '@/components/chat/AcpPermissionSelector'
import { AcpModelSelector } from '@/components/chat/model-selector/AcpModelSelector'
import type { HarnessControls } from '../controls'

/**
 * Permission baseline (ask / plan / auto / always) plus the agent's own session
 * modes when it has them; Grok's effort-shaped modes live on the model control.
 */
function AcpPermissionControl({ compact }: { compact: boolean }) {
  return (
    <>
      <AcpPermissionSelector compact={compact} />
      <AcpModeSelector compact={compact} />
    </>
  )
}

export const acpControls: HarnessControls = {
  ModelControl: AcpModelSelector,
  PermissionControl: AcpPermissionControl,
}
