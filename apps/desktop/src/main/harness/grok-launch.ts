import { resolveGrokRuntime } from '@superone/runtime/harness'
import { getHarnessManager } from './service'

export function resolveDesktopGrokLaunch(override?: { command?: string; args?: string[]; env?: Record<string, string> }) {
  return resolveGrokRuntime(getHarnessManager(), override)
}
