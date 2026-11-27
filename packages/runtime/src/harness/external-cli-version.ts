import { execFileSync } from 'node:child_process'
import { realpathSync, statSync } from 'node:fs'
import {
  checkExternalCliVersion,
  formatExternalCliUpgradeMessage,
  normalizeExternalCliVersion,
  type ExternalCliHarnessId,
  type HarnessDiagnosticFields,
} from '@superone/shared/environment'

export interface ExternalCliCompatibilityResult {
  compatible: boolean
  version?: string
  minVersion: string
  diagnosticFields?: HarnessDiagnosticFields
  upgradeMessage?: string
}

const versionCache = new Map<string, string | undefined>()

function cacheKeyForCommand(command: string): string | null {
  try {
    const resolved = realpathSync(command)
    const st = statSync(resolved)
    return `${resolved}\0${st.mtimeMs}\0${st.size}`
  } catch {
    return null
  }
}

export function clearExternalCliVersionCache(): void {
  versionCache.clear()
}

export function probeExternalCliVersion(
  command: string,
  opts?: { timeoutMs?: number },
): string | undefined {
  const key = cacheKeyForCommand(command)
  if (key && versionCache.has(key)) return versionCache.get(key)
  let version: string | undefined
  try {
    const out = execFileSync(command, ['--version'], {
      timeout: opts?.timeoutMs ?? 2500,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    version = normalizeExternalCliVersion(out)
  } catch (err) {
    const stdout = (err as { stdout?: unknown })?.stdout
    const stderr = (err as { stderr?: unknown })?.stderr
    version =
      normalizeExternalCliVersion(typeof stdout === 'string' ? stdout : undefined) ??
      normalizeExternalCliVersion(typeof stderr === 'string' ? stderr : undefined)
  }
  if (key) versionCache.set(key, version)
  return version
}

export function evaluateExternalCliCompatibility(
  harnessId: ExternalCliHarnessId,
  command: string,
  probe: (cmd: string) => string | undefined = probeExternalCliVersion,
): ExternalCliCompatibilityResult {
  const version = probe(command)
  const check = checkExternalCliVersion(harnessId, version)
  if (!check.ok) {
    return {
      compatible: false,
      version: check.actualVersion,
      minVersion: check.minVersion,
      diagnosticFields: {
        expectedVersion: check.minVersion,
        actualVersion: check.actualVersion,
        command,
      },
      upgradeMessage: formatExternalCliUpgradeMessage(
        harnessId,
        check.actualVersion,
        check.minVersion,
        process.platform,
      ),
    }
  }
  return {
    compatible: true,
    version: check.actualVersion,
    minVersion: check.minVersion,
  }
}
