/**
 * Scan PATH for first-party harness CLIs (onboarding discover step).
 *
 * Claude/Codex are always listed (SuperOne managed download; PATH is advisory).
 * OpenCode / Cursor / Grok only appear when a CLI is on PATH — enable still
 * resolves the command via the harness kernel. Cursor is experimental: do not
 * treat the bundled `@cursor/sdk` as "detected".
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
  cursor: ['cursor'],
  'acp-grok': ['grok'],
  // In-process npm packages; no CLI binary to detect on PATH.
  deepseek: [],
}

const ONBOARDING_ORDER: readonly NodeHarnessId[] = [
  'claude',
  'codex',
  'opencode',
  'cursor',
  'acp-grok',
]

const ALWAYS_VISIBLE_ONBOARDING: ReadonlySet<NodeHarnessId> = new Set(['claude', 'codex'])

function withWinSuffixes(names: string[]): string[] {
  if (process.platform !== 'win32') return names
  const out: string[] = []
  for (const n of names) {
    out.push(n, `${n}.exe`, `${n}.cmd`, `${n}.bat`)
  }
  return out
}

/**
 * Normalize noisy CLI `--version` lines to a bare version (like OpenCode's "1.18.15").
 *  "2.1.223 (Claude Code)" → "2.1.223"
 *  "codex-cli 0.146.1" → "0.146.1"
 *  "grok 1.0.0 (3cd0d0cbcebe)" → "1.0.0"
 */
export function normalizeCliVersion(raw: string): string | undefined {
  const line = raw.split(/\r?\n/).map((s) => s.trim()).find(Boolean)
  if (!line) return undefined
  const m = line.match(/\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?/)
  return m?.[0]
}

function tryVersion(bin: string): string | undefined {
  try {
    const out = execFileSync(bin, ['--version'], {
      timeout: 2500,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return normalizeCliVersion(out)
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
  return ONBOARDING_ORDER.map(scanHarnessCli)
}

/**
 * Right-side integration labels for onboarding rows (no version numbers).
 * Claude/Codex: SuperOne-managed runtimes; Grok: ACP; OpenCode: OpenCode SDK;
 * Cursor: Cursor Agent SDK.
 */
export type IntegrationLabel = {
  label: string
}

export function integrationLabels(): Record<NodeHarnessId, IntegrationLabel> {
  return {
    claude: { label: 'Claude Agent SDK' },
    codex: { label: 'Codex App Server' },
    opencode: { label: 'OpenCode SDK' },
    cursor: { label: 'Cursor Agent SDK' },
    'acp-grok': { label: 'Agent Client Protocol' },
    deepseek: { label: 'DeepSeek Harness (in-process)' },
  }
}

/**
 * Onboarding list: Claude/Codex always; experimental harnesses only when a CLI
 * is on PATH. Order matches the discover row order.
 */
export function visibleOnboardingHarnesses(hits: HarnessCliScanHit[]): NodeHarnessId[] {
  const detected = new Set(hits.filter((h) => h.detected).map((h) => h.harnessId))
  return ONBOARDING_ORDER.filter(
    (id) => ALWAYS_VISIBLE_ONBOARDING.has(id) || detected.has(id),
  )
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
