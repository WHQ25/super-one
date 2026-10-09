import { app } from 'electron'
import { loadNodeAgentSettings } from '@superone/runtime/settings'
import { desktopNodeHostPaths } from './paths'

function configPath(): string {
  return desktopNodeHostPaths(app.getPath('userData')).configJson
}

/** The owner's note agents read when choosing where to run work (`agent.note`, same as `superone note`). */
export function readNodeNote(): string {
  return loadNodeAgentSettings(configPath()).note
}
