import { DeepseekPermissionSelector } from '@/components/chat/DeepseekPermissionSelector'
import { DeepseekModelSelector } from '@/components/chat/model-selector/DeepseekModelSelector'
import type { HarnessControls } from '../controls'

export const dshControls: HarnessControls = {
  ModelControl: DeepseekModelSelector,
  PermissionControl: DeepseekPermissionSelector,
}
