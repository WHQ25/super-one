import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  evaluateExternalCliCompatibility,
  resolveExternalCommand,
  type HarnessManager,
} from '@superone/runtime/harness'
import { buildHarnessDiagnostic, type HarnessInstallationStatus } from '@superone/shared/environment'

function resolveOpenCodeBinary(explicit?: string): string | null {
  const searchNames =
    process.platform === 'win32'
      ? ['opencode.exe', 'opencode.cmd', 'opencode']
      : ['opencode']
  let resolved = resolveExternalCommand(explicit, searchNames)
  if (!explicit && !resolved) {
    const home = homedir()
    for (const dir of [join(home, '.opencode', 'bin'), join(home, '.local', 'bin')]) {
      for (const name of searchNames) {
        resolved = resolveExternalCommand(join(dir, name), [])
        if (resolved) break
      }
      if (resolved) break
    }
  }
  return resolved
}

export function refreshOpencodeInstallation(manager: HarnessManager): HarnessInstallationStatus {
  const status = manager.get('opencode')
  if (!status.enabled) return status
  const config = manager.getExternalLaunchConfig('opencode')
  if (config.serverUrl?.trim()) return status
  const envBin = process.env.SUPERONE_OPENCODE_BINARY?.trim()
  const fromEnv = Boolean(envBin)
  const explicit = envBin || config.command || status.command
  const command = resolveOpenCodeBinary(explicit) ?? (!fromEnv ? resolveOpenCodeBinary() : null)
  const compat = command ? evaluateExternalCliCompatibility('opencode', command) : null
  const state = !command ? 'missing' : compat?.compatible ? 'ready' : 'incompatible'
  const nextVersion = command ? compat?.version : undefined
  const diagnosticCode = !command ? 'not_found' : compat?.compatible ? null : 'incompatible'
  const diagnosticFields = !command || compat?.compatible ? null : (compat?.diagnosticFields ?? null)

  if (
    !fromEnv &&
    (status.command !== (command ?? status.command) ||
      status.state !== state ||
      status.runtimeVersion !== nextVersion ||
      (status.diagnostic?.code ?? null) !== diagnosticCode)
  ) {
    manager.update('opencode', {
      command: command ?? null,
      runtimeVersion: nextVersion ?? null,
      state,
      diagnosticCode,
      diagnosticFields,
    })
  }
  return {
    ...status,
    state,
    command: command ?? undefined,
    runtimeVersion: nextVersion,
    diagnostic: diagnosticCode
      ? buildHarnessDiagnostic(diagnosticCode, diagnosticFields ?? undefined)
      : undefined,
  }
}
