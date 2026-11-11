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
  language: ExternalCliInstallLanguage
  command: string
}

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
  unix: string
  win32: string
}

const INSTALL_COMMANDS: Record<ExternalCliHarnessId, PlatformInstallCommands> = {
  opencode: {
    binaryName: 'opencode',
    unix: 'curl -fsSL https://opencode.ai/v2/install | bash',
    win32: 'npm install -g @opencode/cli',
  },
  'acp-grok': {
    binaryName: 'grok',
    unix: 'curl -fsSL https://x.ai/cli/install.sh | bash',
    win32: 'irm https://x.ai/cli/install.ps1 | iex',
  },
  'acp-antigravity': {
    binaryName: 'agy',
    unix: 'curl -fsSL https://antigravity.google/cli/install.sh | bash',
    win32: 'irm https://antigravity.google/cli/install.ps1 | iex',
  },
}

export function isExternalCliHarnessId(
  id: string | null | undefined,
): id is ExternalCliHarnessId {
  return Boolean(
    id && (EXTERNAL_CLI_HARNESS_IDS as readonly string[]).includes(id),
  )
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
    language: isWin ? 'powershell' : 'bash',
    command: isWin ? entry.win32 : entry.unix,
  }
}
