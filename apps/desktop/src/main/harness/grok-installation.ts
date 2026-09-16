import { resolveGrokRuntime, type HarnessManager } from '@superone/runtime/harness'
import { buildHarnessDiagnostic, type HarnessInstallationStatus } from '@superone/shared/environment'

/** Refresh settings from the launch resolver instead of a historical realpath. */
export function refreshGrokInstallation(manager: HarnessManager): HarnessInstallationStatus {
  const status = manager.get('acp-grok')
  if (!status.enabled) return status
  const launch = resolveGrokRuntime(manager)
  const config = manager.getExternalLaunchConfig('acp-grok')
  const fromEnv = !!process.env.SUPERONE_ACP_BINARY?.trim()
  const repaired = !fromEnv && !config.commandSource && launch?.source === 'path'
  // Keep a missing explicit path in storage so a second refresh cannot silently
  // turn it into automatic discovery. The public row hides the stale command.
  const nextCommand = launch?.command ?? status.command
  const state = launch ? 'ready' : 'missing'
  if (!fromEnv && (status.command !== nextCommand || repaired || status.state !== state || status.runtimeVersion)) {
    manager.update('acp-grok', {
      command: nextCommand ?? null,
      runtimeVersion: null,
      state,
      diagnosticCode: launch ? null : 'not_found',
      ...(repaired ? { configJson: JSON.stringify({ ...config, command: launch.command, commandSource: 'path' }) } : {}),
    })
  }
  return {
    ...status, state, command: launch?.command, runtimeVersion: undefined,
    diagnostic: launch ? undefined : buildHarnessDiagnostic('not_found'),
  }
}
