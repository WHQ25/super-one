import type { ComposerSource } from '@superone/shared/agent-types'
import type { ComposerViewPorts } from '@superone/shared/composer-view-bridge'
import { connectionIdForProjectKey } from './session-list-ops'

/** IPC is unbounded only for the human answer; admission and owner remain host-controlled. */
export function desktopComposerPorts(source: () => ComposerSource | null): ComposerViewPorts {
  const views = new Map<string, string>()
  return {
    async open(request) {
      const owner = source()
      if (!owner) throw new Error('This surface has no active session.')
      const connectionId = connectionIdForProjectKey(owner.kind === 'widget' ? owner.projectPath : owner.projectDir)
      views.set(request.viewId, connectionId)
      const result = await window.environment.callComposer(connectionId, 'composer.open', { source: owner, ...request })
      if (!result.ok) throw new Error(result.error.message)
      return window.environment.callComposer(connectionId, 'composer.await', { inputRequestId: result.requestId })
    },
    release: async (viewId) => {
      const connectionId = views.get(viewId)
      views.delete(viewId)
      if (connectionId) await window.environment.callComposer(connectionId, 'composer.cancel', { viewId })
    },
  }
}
