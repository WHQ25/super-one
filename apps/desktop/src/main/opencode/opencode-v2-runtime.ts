import { createOpenCodeV2Runtime as createNativeRuntime } from '@superone/opencode/native-runtime'
import { OpenCodeV2Client } from './opencode-v2-client'
import {
  buildOpenCodeHostPermissionRules,
  reconcileOpenCodePermissions,
  syncMcpServers,
  type OpenCodeRuntimeOptions,
} from './opencode-runtime'
import type { OpenCodeServerHandle } from './opencode-client'

export function createOpenCodeV2Runtime(server: OpenCodeServerHandle, opts: OpenCodeRuntimeOptions) {
  return createNativeRuntime(server, opts, {
    createClient: (options) => new OpenCodeV2Client(options),
    buildOpenCodeHostPermissionRules,
    reconcileOpenCodePermissions,
    syncMcpServers,
    openUrl: async (url) => {
      const { shell } = await import('electron')
      await shell.openExternal(url)
    },
  })
}
