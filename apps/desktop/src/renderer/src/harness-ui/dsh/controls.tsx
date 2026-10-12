import { DeepseekPermissionModeList, deepseekPermissionModeOption } from '@/components/chat/DeepseekPermissionModeList'
import { DeepseekPermissionSelector } from '@/components/chat/DeepseekPermissionSelector'
import { DeepseekModelSelector } from '@/components/chat/model-selector/DeepseekModelSelector'
import type { HarnessControls } from '../controls'

export const dshControls: HarnessControls = {
  ModelControl: DeepseekModelSelector,
  PermissionControl: DeepseekPermissionSelector,
  launchPermission: (value, select) => {
    const option = deepseekPermissionModeOption(value)
    return {
      labelKey: option.labelKey,
      icon: option.icon,
      toneClass: `${option.color} ${option.hoverBg}`,
      content: <DeepseekPermissionModeList activeMode={option.mode} onSelect={select} />,
    }
  },
}
