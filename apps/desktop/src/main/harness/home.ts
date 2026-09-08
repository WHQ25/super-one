import { join } from 'node:path'
import { superoneHome } from '../superone-home'

/** Every variant installs under its personal root; labs can override binaries. */
export function resolveHarnessHomeRoot(): string {
  return process.env.SUPERONE_HARNESS_HOME?.trim() || join(superoneHome(), 'harness')
}
