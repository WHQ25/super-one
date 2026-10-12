import { AcpModeSelector } from '@/components/chat/AcpModeSelector'
import { AcpPermissionModeList, acpPermissionModeOption } from '@/components/chat/AcpPermissionModeList'
import { AcpPermissionSelector } from '@/components/chat/AcpPermissionSelector'
import { AcpModelSelector } from '@/components/chat/model-selector/AcpModelSelector'
import type { HarnessControls } from '../controls'
import { AcpLaunchModel } from './launch-model'

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
  LaunchModelControl: AcpLaunchModel,
  PermissionControl: AcpPermissionControl,
  launchPermission: (value, select) => {
    const option = acpPermissionModeOption(value)
    return {
      labelKey: `chat.acpPermissionModes.${option.labelKey}.label`,
      icon: option.icon,
      toneClass: `${option.color} ${option.hoverBg}`,
      content: <AcpPermissionModeList activeMode={option.id} onSelect={select} />,
    }
  },
}
