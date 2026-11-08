import {
  isLegacyAntigravityServerCommand,
  resolveAntigravityRuntime,
  type HarnessManager,
} from '@superone/runtime/harness'
import { buildHarnessDiagnostic, type HarnessInstallationStatus } from '@superone/shared/environment'

/** Refresh settings from the launch resolver instead of a historical realpath. */
export function refreshAntigravityInstallation(manager: HarnessManager): HarnessInstallationStatus {
  const status = manager.get('acp-antigravity')
  if (!status.enabled) return status
  const launch = resolveAntigravityRuntime(manager)
  const config = manager.getExternalLaunchConfig('acp-antigravity')
  const fromEnv = !!process.env.SUPERONE_ANTIGRAVITY_BINARY?.trim()
  const migratedLegacy = isLegacyAntigravityServerCommand(config.command ?? status.command)
  const repaired = !fromEnv && (!config.commandSource || migratedLegacy) && launch?.source === 'path'
  const nextCommand = launch?.command ?? (migratedLegacy ? undefined : status.command)
  const state = launch ? 'ready' : 'missing'
  if (
    !fromEnv &&
    (status.command !== nextCommand || repaired || status.state !== state || status.runtimeVersion)
  ) {
    manager.update('acp-antigravity', {
      command: nextCommand ?? null,
      runtimeVersion: null,
      state,
      diagnosticCode: launch ? null : 'not_found',
      diagnosticFields: null,
      ...(repaired
        ? {
            configJson: JSON.stringify({
              ...config,
              command: launch.command,
              commandSource: 'path',
              args: launch.args,
              usesDefaultArgs: true,
            }),
          }
        : {}),
    })
  }
  return {
    ...status,
    state,
    command: launch?.command,
    runtimeVersion: undefined,
    diagnostic: launch ? undefined : buildHarnessDiagnostic('not_found'),
  }
}
