import type { ComponentType, ReactNode } from 'react'
import type { HarnessId, PermissionMode } from '@superone/shared/agent-types'
import { acpControls } from './acp/controls'
import { claudeControls } from './claude/controls'
import { codexControls } from './codex/controls'
import { cursorControls } from './cursor/controls'
import { dshControls } from './dsh/controls'
import { opencodeControls } from './opencode/controls'

/**
 * The chat controls a harness renders for the active session. Generic surfaces
 * look the harness up here and render what it returns, so switching harness
 * swaps the component (and its hooks) instead of branching inside one.
 */
export interface HarnessControls {
  /** Composer model / effort picker. */
  ModelControl: ComponentType<{ onCloseAutoFocus?: (e: Event) => void }>
  /** Status-bar permission control: modes, presets or agents, in the harness's own vocabulary. */
  PermissionControl: ComponentType<{ compact: boolean }>
  /**
   * Permission picker for a session that does not exist yet (launch rows), in
   * the same vocabulary as `PermissionControl` but expressed as the plain
   * `PermissionMode` a launch config carries. Absent: the harness has no modes.
   */
  launchPermission?: (value: PermissionMode, select: (mode: PermissionMode) => void) => LaunchPermissionView
}

export interface LaunchPermissionView {
  labelKey: string
  icon: ReactNode
  toneClass: string
  /** Popover body listing the choices. */
  content: ReactNode
}

export const HARNESS_CONTROLS: { [H in HarnessId]: HarnessControls } = {
  claude: claudeControls,
  codex: codexControls,
  acp: acpControls,
  opencode: opencodeControls,
  cursor: cursorControls,
  dsh: dshControls,
}
