import { app } from 'electron'
import { loadNodeAgentSettings, patchNodeAgentSettings } from '@superone/runtime/settings'
import { desktopNodeHostPaths } from './paths'

function configPath(): string {
  return desktopNodeHostPaths(app.getPath('userData')).configJson
}

/** The owner's note agents read when choosing where to run work (`agent.note`, same as `superone note`). */
export function readNodeNote(): string {
  return loadNodeAgentSettings(configPath()).note
}

/** Replace the note; an empty string clears it. Returns the stored value. */
export function writeNodeNote(note: string): string {
  return patchNodeAgentSettings(configPath(), { note: note.trim() }).note
}
