import { CursorPermissionModeList, cursorPermissionModeOption } from '@/components/chat/CursorPermissionModeList'
import { CursorPermissionSelector } from '@/components/chat/CursorPermissionSelector'
import { CURSOR_PERMISSION_MODES, resolveCursorPermissionMode } from '@/components/chat/cursorPermissionModes'
import { CursorModelSelector } from '@/components/chat/model-selector/CursorModelSelector'
import type { HarnessControls } from '../controls'
import { CursorLaunchModel } from './launch-model'

export const cursorControls: HarnessControls = {
  ModelControl: CursorModelSelector,
  LaunchModelControl: CursorLaunchModel,
  PermissionControl: CursorPermissionSelector,
  launchPermission: (value, select) => {
    const mode = resolveCursorPermissionMode(value)
    const option = cursorPermissionModeOption(mode)
    return {
      labelKey: `chat.cursorPermissionModes.${option.labelKey}.label`,
      icon: option.icon,
      toneClass: `${option.color} ${option.hoverBg}`,
      content: <CursorPermissionModeList activeMode={mode} availableModes={CURSOR_PERMISSION_MODES} onSelect={select} />,
    }
  },
}
