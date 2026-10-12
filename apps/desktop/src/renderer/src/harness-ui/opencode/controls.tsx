import { OpenCodeModelSelector } from '@/components/chat/model-selector/OpenCodeModelSelector'
import { OpenCodeAgentSelector } from '@/components/chat/OpenCodeAgentSelector'
import type { HarnessControls } from '../controls'
import { OpenCodeLaunchModel } from './launch-model'

/** OpenCode has no permission modes; its native agent takes the permission slot. */
export const opencodeControls: HarnessControls = {
  ModelControl: OpenCodeModelSelector,
  LaunchModelControl: OpenCodeLaunchModel,
  PermissionControl: OpenCodeAgentSelector,
}
