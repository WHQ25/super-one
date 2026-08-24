import { ComputerUseService, type ComputerUseServiceOptions } from './computer-use-service'
import { ComputerUsePolicy } from './policy'
import { FakePlatformBackend } from './platform/fake-backend'
import { MacosPlatformAdapter } from './platform/macos-adapter'
import { resolveHelperAppPath } from './platform/macos-helper-client'
import type { PlatformAdapter } from './platform/types'
import { readAppSettings } from '../app-settings-service'
import { claimComputerUseViewfinder } from './viewfinder'
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
 * - auto: fake only in tests; otherwise require the packaged macOS helper
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

  const backend = resolveComputerUseBackend(options.backend ?? 'auto')
  const adapter: PlatformAdapter =
    backend === 'macos'
      ? new MacosPlatformAdapter({
          sessionId: options.sessionId,
          getGrantedBundleIds: () => {
            if (policy.isAllowAllApps()) return []
            return policy.listGranted().map((g) => g.bundleId).filter((id) => id !== '*')
          },
          getAllowAllApps: () => policy.isAllowAllApps(),
          onViewfinderClaim: (claim) => claimComputerUseViewfinder(claim),
          getPictureInPictureEnabled: () => {
            try {
              return readAppSettings().computerUsePictureInPicture !== false
            } catch {
              return true
            }
          },
          getDedicatedDisplayId: () => {
            try {
              return readAppSettings().computerUseDedicatedDisplayId ?? null
            } catch {
              return null
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

export interface ResolveComputerUseBackendOptions {
  platform?: NodeJS.Platform
  allowTestFake?: boolean
  helperAvailable?: boolean
}

export function resolveComputerUseBackend(
  backend: ComputerUseBackendKind,
  options: ResolveComputerUseBackendOptions = {},
): 'fake' | 'macos' {
  if (backend === 'fake') return 'fake'
  const platform = options.platform ?? process.platform
  const allowTestFake = options.allowTestFake
    ?? Boolean(process.env.VITEST || process.env.SUPERONE_CU_FORCE_FAKE === '1')

  // Tests may opt into the deterministic backend, but shipped builds must fail
  // closed instead of reporting fake desktop state as a successful tool result.
  if (backend === 'auto' && allowTestFake) return 'fake'
  if (platform !== 'darwin') {
    throw new Error('Computer Use is only available on macOS')
  }

  const helperAvailable = options.helperAvailable ?? resolveHelperAppPath() != null
  if (!helperAvailable) {
    throw new Error('Computer Use helper is not available in this SuperOne build')
  }
  return 'macos'
}
