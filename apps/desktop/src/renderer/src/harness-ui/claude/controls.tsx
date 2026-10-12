import { ClaudeModelSelector } from '@/components/chat/model-selector/ClaudeModelSelector'
import { PermissionModeSelector } from '@/components/chat/PermissionModeSelector'
import type { HarnessControls } from '../controls'

export const claudeControls: HarnessControls = {
  ModelControl: ClaudeModelSelector,
  PermissionControl: PermissionModeSelector,
}
