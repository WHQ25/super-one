import { CodexPermissionSelector } from '@/components/chat/CodexPermissionSelector'
import { CodexModelSelector } from '@/components/chat/model-selector/CodexModelSelector'
import type { HarnessControls } from '../controls'

export const codexControls: HarnessControls = {
  ModelControl: CodexModelSelector,
  PermissionControl: CodexPermissionSelector,
}
