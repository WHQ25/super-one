import type { PermissionMode } from '@superone/shared/agent-types'
import type { BackendStartOptions } from '../types'
import type { CodexSession } from '../../codex/codex-session'
import { resolvePermissionProfile } from '../../codex/app-server-connection'
import { mapCodexPermissionMode } from './codex-backend-selection'
import log from '../../logger'

/** Keep the next turn's defaults and an active turn's reviewer in sync. */
export async function updateCodexPermissionMode(opts: BackendStartOptions, session: CodexSession, mode: PermissionMode): Promise<void> {
  opts.permissionMode = mode
  const preset = mapCodexPermissionMode(mode, opts.sandboxInfo)
  session.permissionPreset = preset
  const { connectionHandle, threadId, activeTurnId } = session
  if (!connectionHandle || !threadId || !activeTurnId) return
  try {
    const result = await connectionHandle.connection.request('turn/settings/update', {
      threadId, turnId: activeTurnId,
      approvalsReviewer: resolvePermissionProfile(preset).approvalsReviewer,
    })
    if (result.status === 'targetUnavailable') {
      log.debug('[CodexBackend] active turn ended before permission reviewer update')
    }
  } catch (error) {
    // The selected preset still applies to the next turn if this one has ended
    // or an older app-server does not support the experimental live update.
    log.warn('[CodexBackend] live permission reviewer update failed: %s', error instanceof Error ? error.message : String(error))
  }
}
