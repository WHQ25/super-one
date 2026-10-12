import { HARNESS_LAUNCH_OPTIONS } from '@superone/shared/launch-options'
import { ClaudeModelSelector } from '@/components/chat/model-selector/ClaudeModelSelector'
import { modes, PermissionModeList } from '@/components/chat/PermissionModeList'
import { PermissionModeSelector } from '@/components/chat/PermissionModeSelector'
import { ClaudeSessionIcon } from '@superone/ui/components/harness/ClaudeSessionIcon'
import type { HarnessControls } from '../controls'
import { ClaudeLaunchModel } from './launch-model'

const LAUNCH_MODES = HARNESS_LAUNCH_OPTIONS.claude.permissionModes

export const claudeControls: HarnessControls = {
  ModelControl: ClaudeModelSelector,
  LaunchModelControl: ClaudeLaunchModel,
  PickerIcon: ({ size }) => <ClaudeSessionIcon status="default" size={size} />,
  PermissionControl: PermissionModeSelector,
  launchPermission: (value, select) => {
    const active = modes.find((mode) => mode.id === value && LAUNCH_MODES.includes(mode.id)) ?? modes[0]
    return {
      labelKey: `chat.permissionModes.${active.id}.label`,
      icon: active.icon,
      toneClass: `${active.color} ${active.hoverBg}`,
      content: <PermissionModeList activeMode={active.id} availableModes={LAUNCH_MODES} onSelect={select} />,
    }
  },
}
