import { resolveAntigravityRuntime, type AntigravityResolvedRuntime } from '@superone/runtime/harness'
import { getHarnessManager } from './service'

export function resolveDesktopAntigravityLaunch(override?: {
  command?: string
  args?: string[]
  env?: Record<string, string>
}): AntigravityResolvedRuntime | null {
  try {
    return resolveAntigravityRuntime(getHarnessManager(), { override })
  } catch {
    return null
  }
}
