import type { ComposerSource } from '@superone/shared/agent-types'
import type { ComposerViewPorts } from '@superone/shared/composer-view-bridge'

/** IPC is unbounded only for the human answer; admission and owner remain host-controlled. */
export function desktopComposerPorts(source: () => ComposerSource | null): ComposerViewPorts {
  return {
    async open(request) {
      const owner = source()
      if (!owner) throw new Error('This surface has no active session.')
      const result = await window.agent.composerOpen({ source: owner, ...request })
      if (!result.ok) throw new Error(result.error.message)
      return window.agent.composerAwait(result.requestId)
    },
    release: viewId => window.agent.composerCancel(viewId),
  }
}
