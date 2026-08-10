/**
 * Desktop harness install root: ~/.superone/harness/
 *
 * Mirrors ~/.superone/mcpb and ~/.superone/apps. Kernel treats this as
 * HarnessHome.root (same role as CLI $NODE_HOME).
 */

import { app } from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'

export function resolveHarnessHomeRoot(): string {
  const home = (() => {
    try {
      return app.getPath('home')
    } catch {
      return homedir()
    }
  })()
  return join(home, '.superone', 'harness')
}
