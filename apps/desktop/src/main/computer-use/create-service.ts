import { ComputerUseService, type ComputerUseServiceOptions } from './computer-use-service'
import { ComputerUsePolicy } from './policy'
import { FakePlatformBackend } from './platform/fake-backend'
import { MacosPlatformAdapter } from './platform/macos-adapter'
import { resolveHelperAppPath } from './platform/macos-helper-client'
import type { PlatformAdapter } from './platform/types'
import { readAppSettings } from '../app-settings-service'
import { getCurrentLocale } from '../i18n'

export type ComputerUseBackendKind = 'fake' | 'macos' | 'auto'

export interface CreateComputerUseServiceOptions extends ComputerUseServiceOptions {
  backend?: ComputerUseBackendKind
  /** Session driving this service; forwarded to the helper for the status menu. */
  sessionId?: string
}

/**
 * Create a ComputerUseService with the appropriate platform adapter.
 * - fake: deterministic tests / CI
 * - macos: native helper (requires SuperOne Computer Use.app)
 * - auto: macos when helper app is present on darwin, else fake
 */
export function createComputerUseService(
  options: CreateComputerUseServiceOptions = {},
): ComputerUseService {
  const policy = options.policy ?? new ComputerUsePolicy()

  // Pull latest settings flags into policy (tests may override via policy directly).
  try {
    const s = readAppSettings()
    if (s.computerUseEnabled) policy.setEnabled(true)
    if (s.computerUseAllowAllApps) policy.setAllowAllApps(true)
    if (s.computerUseAlwaysAllowApps?.length) {
      policy.setAlwaysAllowApps(s.computerUseAlwaysAllowApps)
    }
  } catch {
    // electron unavailable in pure unit tests
  }

  if (options.adapter) {
    return new ComputerUseService({ ...options, policy })
  }

  const backend = resolveBackend(options.backend ?? 'auto')
  const adapter: PlatformAdapter =
    backend === 'macos'
      ? new MacosPlatformAdapter({
          sessionId: options.sessionId,
          getGrantedBundleIds: () => {
            if (policy.isAllowAllApps()) return []
            return policy.listGranted().map((g) => g.bundleId).filter((id) => id !== '*')
          },
          getAllowAllApps: () => policy.isAllowAllApps(),
          getVisualIndicators: () => {
            try {
              return readAppSettings().computerUseVisualIndicators !== false
            } catch {
              return true
            }
          },
          getLocale: getCurrentLocale,
        })
      : new FakePlatformBackend()

  return new ComputerUseService({
    ...options,
    policy,
    adapter,
  })
}

function resolveBackend(backend: ComputerUseBackendKind): 'fake' | 'macos' {
  if (backend === 'fake') return 'fake'
  if (backend === 'macos') return 'macos'
  // Vitest / CI: never auto-launch the native helper (would hang on TCC / socket).
  if (process.env.VITEST || process.env.SUPERONE_CU_FORCE_FAKE === '1') return 'fake'
  if (process.platform === 'darwin' && resolveHelperAppPath()) return 'macos'
  return 'fake'
}
