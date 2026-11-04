import { resolveAntigravityRuntime, type AntigravityResolvedRuntime } from '@superone/runtime/harness'
import { resolveHarnessHomeRoot } from './home'
import { getHarnessManager } from './service'

export function resolveDesktopAntigravityLaunch(override?: {
  command?: string
  args?: string[]
  env?: Record<string, string>
}): AntigravityResolvedRuntime | null {
  try {
    return resolveAntigravityRuntime(getHarnessManager(), {
      homeRoot: resolveHarnessHomeRoot(),
      override,
    })
  } catch {
    return null
  }
}
