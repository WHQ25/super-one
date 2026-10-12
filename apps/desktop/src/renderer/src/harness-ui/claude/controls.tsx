import { HARNESS_LAUNCH_OPTIONS } from '@superone/shared/launch-options'
import { ClaudeModelSelector } from '@/components/chat/model-selector/ClaudeModelSelector'
import { modes, PermissionModeList } from '@/components/chat/PermissionModeList'
import { PermissionModeSelector } from '@/components/chat/PermissionModeSelector'
import type { HarnessControls } from '../controls'

const LAUNCH_MODES = HARNESS_LAUNCH_OPTIONS.claude.permissionModes

export const claudeControls: HarnessControls = {
  ModelControl: ClaudeModelSelector,
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
