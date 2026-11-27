import {
  evaluateExternalCliCompatibility,
  isLegacyAntigravityServerCommand,
  resolveAntigravityRuntime,
  type HarnessManager,
} from '@superone/runtime/harness'
import { buildHarnessDiagnostic, type HarnessInstallationStatus } from '@superone/shared/environment'

export function refreshAntigravityInstallation(manager: HarnessManager): HarnessInstallationStatus {
  const status = manager.get('acp-antigravity')
  if (!status.enabled) return status
  const launch = resolveAntigravityRuntime(manager)
  const config = manager.getExternalLaunchConfig('acp-antigravity')
  const fromEnv = !!process.env.SUPERONE_ANTIGRAVITY_BINARY?.trim()
  const migratedLegacy = isLegacyAntigravityServerCommand(config.command ?? status.command)
  const repaired = !fromEnv && (!config.commandSource || migratedLegacy) && launch?.source === 'path'
  const nextCommand = launch?.command ?? (migratedLegacy ? undefined : status.command)
  const compat = launch ? evaluateExternalCliCompatibility('acp-antigravity', launch.command) : null
  const state = !launch ? 'missing' : compat?.compatible ? 'ready' : 'incompatible'
  const nextVersion = launch ? compat?.version : undefined
  const diagnosticCode = !launch ? 'not_found' : compat?.compatible ? null : 'incompatible'
  const diagnosticFields = !launch || compat?.compatible ? null : (compat?.diagnosticFields ?? null)

  if (
    !fromEnv &&
    (status.command !== nextCommand ||
      repaired ||
      status.state !== state ||
      status.runtimeVersion !== nextVersion ||
      (status.diagnostic?.code ?? null) !== diagnosticCode)
  ) {
    manager.update('acp-antigravity', {
      command: nextCommand ?? null,
      runtimeVersion: nextVersion ?? null,
      state,
      diagnosticCode,
      diagnosticFields,
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
    runtimeVersion: nextVersion,
    diagnostic: diagnosticCode
      ? buildHarnessDiagnostic(diagnosticCode, diagnosticFields ?? undefined)
      : undefined,
  }
}
