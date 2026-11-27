import type { HarnessInstallationStatus } from './harness-installation'

export const EXTERNAL_CLI_HARNESS_IDS = [
  'opencode',
  'acp-grok',
  'acp-antigravity',
] as const

export type ExternalCliHarnessId = (typeof EXTERNAL_CLI_HARNESS_IDS)[number]

export type ExternalCliInstallLanguage = 'bash' | 'powershell'

export interface ExternalCliInstallSpec {
  harnessId: ExternalCliHarnessId
  binaryName: string
  minVersion: string
  language: ExternalCliInstallLanguage
  command: string
  upgradeCommand: string
}

export type ExternalCliVersionCheck =
  | { ok: true; actualVersion?: string; minVersion: string }
  | { ok: false; actualVersion: string; minVersion: string }

export type ExternalCliInstallPhase = 'start' | 'output' | 'done' | 'error'

export interface ExternalCliInstallEvent {
  harnessId: ExternalCliHarnessId
  phase: ExternalCliInstallPhase
  data?: string
  exitCode?: number
  message?: string
}

export interface ExternalCliInstallResult {
  ok: boolean
  harnessId: ExternalCliHarnessId
  exitCode: number
  message?: string
  status?: HarnessInstallationStatus
}

interface PlatformInstallCommands {
  binaryName: string
  minVersion: string
  unix: string
  win32: string
  upgradeCommand: string
}

export const EXTERNAL_CLI_MIN_VERSIONS: Readonly<Record<ExternalCliHarnessId, string>> = {
  opencode: '2.0.0',
  'acp-grok': '1.0.92',
  'acp-antigravity': '1.5.16',
}

const INSTALL_COMMANDS: Record<ExternalCliHarnessId, PlatformInstallCommands> = {
  opencode: {
    binaryName: 'opencode',
    minVersion: EXTERNAL_CLI_MIN_VERSIONS.opencode,
    unix: 'curl -fsSL https://opencode.ai/v2/install | bash',
    win32: 'npm install -g @opencode/cli',
    upgradeCommand: 'opencode upgrade',
  },
  'acp-grok': {
    binaryName: 'grok',
    minVersion: EXTERNAL_CLI_MIN_VERSIONS['acp-grok'],
    unix: 'curl -fsSL https://x.ai/cli/install.sh | bash',
    win32: 'irm https://x.ai/cli/install.ps1 | iex',
    upgradeCommand: 'grok update',
  },
  'acp-antigravity': {
    binaryName: 'agy',
    minVersion: EXTERNAL_CLI_MIN_VERSIONS['acp-antigravity'],
    unix: 'curl -fsSL https://antigravity.google/cli/install.sh | bash',
    win32: 'irm https://antigravity.google/cli/install.ps1 | iex',
    upgradeCommand: 'agy update',
  },
}

const ANSI_ESCAPE_RE = /\x1b(?:\][^\x07\x1b]*(?:\x07|\x1b\\)|\[[0-?]*[ -/]*[@-~]|[@-Z\\-_])/g
const ANSI_CURSOR_CR_RE = /\x1b\[(?:0*1?G|999D)/g
const FAILURE_LINE_RE = /\b(?:error|fail(?:ed|ure)?|denied|not found|unable|cannot)\b/i

export function isExternalCliHarnessId(
  id: string | null | undefined,
): id is ExternalCliHarnessId {
  return Boolean(
    id && (EXTERNAL_CLI_HARNESS_IDS as readonly string[]).includes(id),
  )
}

export function getExternalCliMinVersion(harnessId: ExternalCliHarnessId): string {
  return EXTERNAL_CLI_MIN_VERSIONS[harnessId]
}

export function normalizeExternalCliVersion(raw: string | null | undefined): string | undefined {
  if (typeof raw !== 'string') return undefined
  const line = raw.split(/\r?\n/).map((s) => s.trim()).find(Boolean)
  if (!line) return undefined
  const m = line.match(/\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?/)
  return m?.[0]
}

function parseVersionTuple(raw: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)(?:\.(\d+))?/.exec(raw.trim())
  if (!m) return null
  return [
    Number.parseInt(m[1]!, 10),
    Number.parseInt(m[2]!, 10),
    m[3] !== undefined ? Number.parseInt(m[3], 10) : 0,
  ]
}

export function compareExternalCliVersions(actual: string, minimum: string): number | null {
  const a = parseVersionTuple(actual)
  const b = parseVersionTuple(minimum)
  if (!a || !b) return null
  for (let i = 0; i < 3; i += 1) {
    if (a[i]! !== b[i]!) return a[i]! < b[i]! ? -1 : 1
  }
  return 0
}

export function checkExternalCliVersion(
  harnessId: ExternalCliHarnessId,
  version: string | null | undefined,
): ExternalCliVersionCheck {
  const minVersion = EXTERNAL_CLI_MIN_VERSIONS[harnessId]
  const normalized = normalizeExternalCliVersion(version)
  if (!normalized) return { ok: true, minVersion }
  const cmp = compareExternalCliVersions(normalized, minVersion)
  if (cmp !== null && cmp < 0) {
    return { ok: false, actualVersion: normalized, minVersion }
  }
  return { ok: true, actualVersion: normalized, minVersion }
}

export function formatExternalCliUpgradeMessage(
  harnessId: ExternalCliHarnessId,
  actualVersion: string,
  minVersion = EXTERNAL_CLI_MIN_VERSIONS[harnessId],
  platform: string = 'darwin',
): string {
  const spec = getExternalCliInstallSpec(harnessId, platform)
  return `${spec.binaryName} CLI ${actualVersion} is below the minimum supported version ${minVersion}. Upgrade in Settings → Harnesses or run: ${spec.upgradeCommand}`
}

export function getExternalCliInstallSpec(
  harnessId: ExternalCliHarnessId,
  platform: string = 'darwin',
): ExternalCliInstallSpec {
  const entry = INSTALL_COMMANDS[harnessId]
  const isWin = platform === 'win32'
  return {
    harnessId,
    binaryName: entry.binaryName,
    minVersion: entry.minVersion,
    language: isWin ? 'powershell' : 'bash',
    command: isWin ? entry.win32 : entry.unix,
    upgradeCommand: entry.upgradeCommand,
  }
}

function cleanCliProgressLine(raw: string, maxLength: number): string | null {
  if (/\x1b(?:\[[0-9]*)?$/.test(raw)) return null
  const text = raw.replace(ANSI_ESCAPE_RE, '').replace(/\s+/g, ' ').trim()
  if (!text) return null
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`
}

export function extractLatestCliProgressLine(output: string, maxLength = 160): string | null {
  if (!output) return null
  const lines = output.replace(ANSI_CURSOR_CR_RE, '\r').split(/\r\n|\r|\n/)
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const cleaned = cleanCliProgressLine(lines[i] ?? '', maxLength)
    if (cleaned) return cleaned
  }
  return null
}

export function extractCliFailureReason(output: string, maxLength = 200): string | null {
  if (!output) return null
  const cleaned = output
    .replace(ANSI_CURSOR_CR_RE, '\r')
    .split(/\r\n|\r|\n/)
    .map((line) => cleanCliProgressLine(line, maxLength))
    .filter((line): line is string => line !== null)
  for (let i = cleaned.length - 1; i >= 0; i -= 1) {
    if (FAILURE_LINE_RE.test(cleaned[i]!)) return cleaned[i]!
  }
  return cleaned.at(-1) ?? null
}
