/**
 * Scan PATH for first-party harness CLIs (onboarding discover step).
 *
 * Detection is advisory only for Claude/Codex (product: always SuperOne managed
 * download on enable). For OpenCode / Grok it still only reports presence —
 * enable resolves command via the harness kernel.
 */

import { execFileSync } from 'node:child_process'
import { resolveExternalCommand } from '@superone/runtime/harness'
import type { NodeHarnessId } from '@superone/shared/environment'

export type HarnessCliScanHit = {
  harnessId: NodeHarnessId
  /** Absolute path when found; null when not on PATH. */
  command: string | null
  detected: boolean
  /** Best-effort `--version` first line; omitted when unavailable. */
  version?: string
}

const SEARCH_NAMES: Record<NodeHarnessId, string[]> = {
  claude: ['claude'],
  codex: ['codex'],
  opencode: ['opencode'],
  'acp-grok': ['grok'],
}

function withWinSuffixes(names: string[]): string[] {
  if (process.platform !== 'win32') return names
  const out: string[] = []
  for (const n of names) {
    out.push(n, `${n}.exe`, `${n}.cmd`, `${n}.bat`)
  }
  return out
}

function tryVersion(bin: string): string | undefined {
  try {
    const out = execFileSync(bin, ['--version'], {
      timeout: 2500,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const line = out.split(/\r?\n/).map((s) => s.trim()).find(Boolean)
    return line ? line.slice(0, 80) : undefined
  } catch {
    return undefined
  }
}

export function scanHarnessCli(harnessId: NodeHarnessId): HarnessCliScanHit {
  const names = withWinSuffixes(SEARCH_NAMES[harnessId] ?? [harnessId])
  const command = resolveExternalCommand(undefined, names)
  if (!command) {
    return { harnessId, command: null, detected: false }
  }
  return {
    harnessId,
    command,
    detected: true,
    version: tryVersion(command),
  }
}

export function scanAllHarnessClis(): HarnessCliScanHit[] {
  const ids: NodeHarnessId[] = ['claude', 'codex', 'opencode', 'acp-grok']
  return ids.map(scanHarnessCli)
}

/**
 * Default checkbox set for onboarding:
 * - every detected CLI pre-checked
 * - if none detected, check Claude only (will managed-download)
 */
export function defaultOnboardingSelection(hits: HarnessCliScanHit[]): NodeHarnessId[] {
  const detected = hits.filter((h) => h.detected).map((h) => h.harnessId)
  if (detected.length > 0) return detected
  return ['claude']
}
