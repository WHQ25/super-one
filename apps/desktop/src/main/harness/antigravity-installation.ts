import { resolveAntigravityRuntime, type HarnessManager } from '@superone/runtime/harness'
import { buildHarnessDiagnostic, type HarnessInstallationStatus } from '@superone/shared/environment'
import { resolveHarnessHomeRoot } from './home'

export function refreshAntigravityInstallation(manager: HarnessManager): HarnessInstallationStatus {
  const status = manager.get('acp-antigravity')
  if (!status.enabled) return status
  if (status.state === 'installing') return status
  const launch = resolveAntigravityRuntime(manager, { homeRoot: resolveHarnessHomeRoot() })
  if (!launch) {
    if (status.state !== 'missing') {
      manager.update('acp-antigravity', {
        state: 'missing',
        command: null,
        diagnosticCode: 'not_found',
      })
    }
    return {
      ...status,
      state: 'missing',
      command: undefined,
      diagnostic: buildHarnessDiagnostic('not_found'),
    }
  }
  if (
    status.state !== 'ready' ||
    status.command !== launch.executablePath ||
    status.runtimeVersion !== launch.runtimeVersion
  ) {
    manager.update('acp-antigravity', {
      state: 'ready',
      command: launch.executablePath,
      runtimeVersion: launch.runtimeVersion ?? null,
      diagnosticCode: null,
      diagnosticFields: null,
    })
  }
  return {
    ...status,
    state: 'ready',
    command: launch.executablePath,
    runtimeVersion: launch.runtimeVersion,
    diagnostic: undefined,
  }
}
