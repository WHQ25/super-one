import {
  evaluateExternalCliCompatibility,
  resolveGrokRuntime,
  type HarnessManager,
} from '@superone/runtime/harness'
import { buildHarnessDiagnostic, type HarnessInstallationStatus } from '@superone/shared/environment'

export function refreshGrokInstallation(manager: HarnessManager): HarnessInstallationStatus {
  const status = manager.get('acp-grok')
  if (!status.enabled) return status
  const launch = resolveGrokRuntime(manager)
  const config = manager.getExternalLaunchConfig('acp-grok')
  const fromEnv = !!process.env.SUPERONE_ACP_BINARY?.trim()
  const repaired = !fromEnv && !config.commandSource && launch?.source === 'path'
  const nextCommand = launch?.command ?? status.command
  const compat = launch ? evaluateExternalCliCompatibility('acp-grok', launch.command) : null
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
    manager.update('acp-grok', {
      command: nextCommand ?? null,
      runtimeVersion: nextVersion ?? null,
      state,
      diagnosticCode,
      diagnosticFields,
      ...(repaired ? { configJson: JSON.stringify({ ...config, command: launch.command, commandSource: 'path' }) } : {}),
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
