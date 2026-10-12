import { CursorPermissionSelector } from '@/components/chat/CursorPermissionSelector'
import { CursorModelSelector } from '@/components/chat/model-selector/CursorModelSelector'
import type { HarnessControls } from '../controls'

export const cursorControls: HarnessControls = {
  ModelControl: CursorModelSelector,
  PermissionControl: CursorPermissionSelector,
}
