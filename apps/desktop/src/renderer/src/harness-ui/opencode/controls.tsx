import { OpenCodeModelSelector } from '@/components/chat/model-selector/OpenCodeModelSelector'
import { OpenCodeAgentSelector } from '@/components/chat/OpenCodeAgentSelector'
import { OpenCode } from '@lobehub/icons'
import type { HarnessControls } from '../controls'
import { OpenCodeLaunchModel } from './launch-model'

/** OpenCode has no permission modes; its native agent takes the permission slot. */
export const opencodeControls: HarnessControls = {
  ModelControl: OpenCodeModelSelector,
  LaunchModelControl: OpenCodeLaunchModel,
  PickerIcon: ({ size }) => <OpenCode size={size} />,
  PermissionControl: OpenCodeAgentSelector,
}
