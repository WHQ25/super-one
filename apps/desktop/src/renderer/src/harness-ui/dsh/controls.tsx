import { DeepseekPermissionModeList, deepseekPermissionModeOption } from '@/components/chat/DeepseekPermissionModeList'
import { DeepseekPermissionSelector } from '@/components/chat/DeepseekPermissionSelector'
import { DeepseekModelSelector } from '@/components/chat/model-selector/DeepseekModelSelector'
import { DeepseekSessionIcon } from '@superone/ui/components/harness/DeepseekSessionIcon'
import type { HarnessControls } from '../controls'
import { DshLaunchModel } from './launch-model'

export const dshControls: HarnessControls = {
  ModelControl: DeepseekModelSelector,
  LaunchModelControl: DshLaunchModel,
  PickerIcon: ({ size }) => <DeepseekSessionIcon status="default" size={size} />,
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
