import { AcpModeSelector } from '@/components/chat/AcpModeSelector'
import { AcpPermissionModeList, acpPermissionModeOption } from '@/components/chat/AcpPermissionModeList'
import { AcpPermissionSelector } from '@/components/chat/AcpPermissionSelector'
import { AcpModelSelector } from '@/components/chat/model-selector/AcpModelSelector'
import { AcpDefaultModelRows } from '@/components/AcpPreferencesPage'
import { Antigravity, Grok } from '@lobehub/icons'
import { isAntigravityAcpAgent, isGrokAcpAgent } from '@superone/shared/acp-brand'
import { AcpSessionIcon } from '@superone/ui/components/harness/AcpSessionIcon'
import type { HarnessControls } from '../controls'
import { AcpLaunchModel } from './launch-model'

function AcpPermissionControl({ compact }: { compact: boolean }) {
  return (
    <>
      <AcpPermissionSelector compact={compact} />
      <AcpModeSelector compact={compact} />
    </>
  )
}

export const acpControls: HarnessControls = {
  launchAgentField: 'acpAgentId',
  ModelControl: AcpModelSelector,
  LaunchModelControl: AcpLaunchModel,
  PreferencesExtra: AcpDefaultModelRows,
  PickerIcon: ({ size, acpAgentId }) => {
    if (!acpAgentId || isGrokAcpAgent(acpAgentId)) {
      return <Grok size={size} className="text-foreground" />
    }
    if (isAntigravityAcpAgent(acpAgentId)) {
      return <Antigravity.Color size={size} />
    }
    return <AcpSessionIcon status="default" size={size} />
  },
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
