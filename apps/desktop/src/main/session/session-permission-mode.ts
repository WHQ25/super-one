import type { PermissionMode, SandboxInfo, SessionSettingsPatch } from '@superone/shared/agent-types'
import { HARNESS_LAUNCH_OPTIONS } from '@superone/shared/launch-options'
import { trace } from '../agent/event-trace'
import { mapCodexPermissionMode } from './backends/codex-backend-selection'
import type { HarnessId, SessionBackend, SessionStatus } from './types'

/** Commit a shared mode and its native selection only after the backend accepts it. */
export async function changeSessionPermissionMode(
  mode: PermissionMode,
  target: {
    id: string
    harnessId: HarnessId
    permissionMode: PermissionMode
    sandboxInfo: SandboxInfo
    status: SessionStatus
    backendStarted: boolean
    backend: Pick<SessionBackend, 'setPermissionMode'>
  },
): Promise<SessionSettingsPatch | null> {
  // A harness without modes owns its permission configuration.
  if (mode !== 'default' && HARNESS_LAUNCH_OPTIONS[target.harnessId].permissionModes.length === 0) {
    throw new Error(`${target.harnessId} has no permission modes; permissions follow its own configuration`)
  }
  const prev = target.permissionMode
  const sid = target.id
  trace('permission.flow', 'session_setMode_in', { sid, prev, next: mode, status: target.status, backendStarted: target.backendStarted })
  if (prev === mode) {
    trace('permission.flow', 'session_setMode_noop', { sid, mode })
    return null
  }
  // Prewarmed runtimes may already exist before backendStarted becomes true.
  // A rejected RPC must leave both the generic mode and native preset intact.
  trace('permission.flow', 'session_setMode_fast_path', { sid, prev, next: mode, backendStarted: target.backendStarted })
  try {
    await target.backend.setPermissionMode(mode)
    trace('permission.flow', 'session_setMode_fast_done', { sid, mode })
  } catch (error) {
    trace('permission.flow', 'session_setMode_fast_error', { sid, mode, err: (error as Error)?.message })
    throw error
  }
  return {
    permissionMode: mode,
    // Sends carry this session-owned preset, ahead of the backend's mode.
    ...(target.harnessId === 'codex' ? { selectedCodexPermissionPreset: mapCodexPermissionMode(mode, target.sandboxInfo) } : {}),
  }
}
