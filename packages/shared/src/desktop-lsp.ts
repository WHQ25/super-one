export type LspServerId = 'typescript' | (string & {})

export type LspServerInstallStatus = 'not_installed' | 'installed' | 'installing' | 'error'

export interface LspRunningWorkspace {
  workspaceRoot: string
  pid: number | null
  lastActiveAt: number
}

export interface CustomLspServerConfig {
  id: string
  label: string
  command: string
  args: string[]
  languages: string[]
}

export interface LspServerInfo {
  id: LspServerId
  label: string
  serverName: string
  description?: string | null
  homepage?: string | null
  sourceId?: string | null
  githubRepo?: string | null
  githubStars?: number | null
  fromRegistry?: boolean
  custom?: boolean
  command?: string
  args?: string[]
  languages: string[]
  installStatus: LspServerInstallStatus
  installable: boolean
  installHint: string | null
  version: string | null
  binaryPath: string | null
  managed: boolean
  installError: string | null
  enabled: boolean
  runningWorkspaces: LspRunningWorkspace[]
}

export interface LspMessageEvent {
  workspaceRoot: string
  serverId: LspServerId
  message: string
}

export interface LspLanguageStat {
  language: string
  count: number
  ratio: number
}

export interface LspProjectDetection {
  languages: LspLanguageStat[]
  preferredServers: string[]
}
