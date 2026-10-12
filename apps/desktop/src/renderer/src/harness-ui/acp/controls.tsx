import { AcpModeSelector } from '@/components/chat/AcpModeSelector'
import { AcpPermissionModeList, acpPermissionModeOption } from '@/components/chat/AcpPermissionModeList'
import { AcpPermissionSelector } from '@/components/chat/AcpPermissionSelector'
import { AcpModelSelector } from '@/components/chat/model-selector/AcpModelSelector'
import { Grok } from '@lobehub/icons'
import { isGrokAcpAgent } from '@superone/shared/acp-brand'
import { AcpSessionIcon } from '@superone/ui/components/harness/AcpSessionIcon'
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
  // Default / Grok Build → official Grok mark; other ACP agents keep the generic ACP glyph.
  PickerIcon: ({ size, acpAgentId }) => (!acpAgentId || isGrokAcpAgent(acpAgentId)
    ? <Grok size={size} className="text-foreground" />
    : <AcpSessionIcon status="default" size={size} />),
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
