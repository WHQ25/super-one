import { AcpModeSelector } from '@/components/chat/AcpModeSelector'
import { AcpPermissionModeList, acpPermissionModeOption } from '@/components/chat/AcpPermissionModeList'
import { AcpPermissionSelector } from '@/components/chat/AcpPermissionSelector'
import { AcpModelSelector } from '@/components/chat/model-selector/AcpModelSelector'
import { AcpDefaultModelRows } from '@/components/AcpPreferencesPage'
import { Antigravity, Grok } from '@lobehub/icons'
import { acpAgentIdForHarness, isAntigravityAcpAgent, isGrokAcpAgent } from '@superone/shared/acp-brand'
import { AcpSessionIcon } from '@superone/ui/components/harness/AcpSessionIcon'
import type { HarnessControls } from '../controls'
import type { AcpHarnessId } from '@/stores/chat-store/harness/acp-slots'
import { AcpLaunchModel } from './launch-model'

function AcpPermissionControl({ compact }: { compact: boolean }) {
  return (
    <>
      <AcpPermissionSelector compact={compact} />
      <AcpModeSelector compact={compact} />
    </>
  )
}

function createAcpControls(harnessId: AcpHarnessId): HarnessControls {
  const canonicalAgentId = acpAgentIdForHarness(harnessId)
  return {
    launchAgentField: 'acpAgentId',
    ModelControl: AcpModelSelector,
    LaunchModelControl: (props) => <AcpLaunchModel {...props} harnessId={harnessId} />,
    PreferencesExtra: ({ acpAgentId }) => (
      <AcpDefaultModelRows acpAgentId={acpAgentId ?? canonicalAgentId} harnessId={harnessId} />
    ),
    PickerIcon: ({ size, acpAgentId }) => {
      const agentId = acpAgentId ?? canonicalAgentId
      if (!agentId || isGrokAcpAgent(agentId)) {
        return <Grok size={size} className="text-foreground" />
      }
      if (isAntigravityAcpAgent(agentId)) {
        return <Antigravity.Color size={size} />
      }
      return <AcpSessionIcon status="default" size={size} />
    },
    PermissionControl: AcpPermissionControl,
    launchPermission: (value, select) => {
      const option = acpPermissionModeOption(value, canonicalAgentId)
      return {
        labelKey: `chat.acpPermissionModes.${option.labelKey}.label`,
        icon: option.icon,
        toneClass: `${option.color} ${option.hoverBg}`,
        content: <AcpPermissionModeList activeMode={option.id} onSelect={select} />,
      }
    },
  }
}

export const acpGrokControls = createAcpControls('acp-grok')
export const acpAntigravityControls = createAcpControls('acp-antigravity')
