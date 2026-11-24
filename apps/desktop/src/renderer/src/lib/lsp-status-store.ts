import type { LspServerInfo } from '@superone/shared/desktop-lsp'
import { resolveLspTarget } from '@superone/shared/lsp-languages'
import { inferLanguage } from '@/lib/shiki-highlighter'

export type LspClientPhase = 'starting' | 'indexing' | 'ready' | 'error'

export interface LspClientEntryStatus {
  phase: LspClientPhase
  error: string | null
}

export interface ResolvedLspServer {
  serverId: string
  languageId: string
  serverName?: string
  serverLabel?: string
}

const clientStatusMap = new Map<string, LspClientEntryStatus>()
const statusListeners = new Set<() => void>()
const restartListeners = new Set<() => void>()
let statusVersion = 0
let restartVersion = 0
let clientDisposer: ((serverId: string, workspaceRoot: string) => void) | null = null

export function normalizeLspWorkspaceRoot(workspaceRoot: string): string {
  const normalized = workspaceRoot.replace(/\/+$/, '')
  return normalized || '/'
}

export function lspClientKey(serverId: string, workspaceRoot: string): string {
  return `${serverId}::${normalizeLspWorkspaceRoot(workspaceRoot)}`
}

function notifyStatusListeners(): void {
  statusVersion += 1
  for (const listener of statusListeners) {
    listener()
  }
}

export function registerLspClientDisposer(
  disposer: (serverId: string, workspaceRoot: string) => void,
): void {
  clientDisposer = disposer
}

export function setLspClientStatus(
  serverId: string,
  workspaceRoot: string,
  status: LspClientEntryStatus | null,
): void {
  const key = lspClientKey(serverId, workspaceRoot)
  const prev = clientStatusMap.get(key) ?? null
  if (prev === status || (prev && status && prev.phase === status.phase && prev.error === status.error)) {
    return
  }
  if (status) {
    clientStatusMap.set(key, status)
  } else {
    clientStatusMap.delete(key)
  }
  notifyStatusListeners()
}

export function getLspClientStatus(
  serverId: string,
  workspaceRoot: string,
): LspClientEntryStatus | null {
  return clientStatusMap.get(lspClientKey(serverId, workspaceRoot)) ?? null
}

export function getLspStatusVersion(): number {
  return statusVersion
}

export function subscribeLspClientStatus(listener: () => void): () => void {
  statusListeners.add(listener)
  return () => {
    statusListeners.delete(listener)
  }
}

export function getLspRestartVersion(): number {
  return restartVersion
}

export function subscribeLspRestart(listener: () => void): () => void {
  restartListeners.add(listener)
  return () => {
    restartListeners.delete(listener)
  }
}

export async function restartLspWorkspace(
  serverId: string,
  workspaceRoot: string,
): Promise<void> {
  clientDisposer?.(serverId, workspaceRoot)
  setLspClientStatus(serverId, workspaceRoot, null)
  await window.app?.stopLspWorkspace?.(serverId, workspaceRoot)
  restartVersion += 1
  for (const listener of restartListeners) {
    listener()
  }
}

function matchEnabledServerFromList(
  servers: readonly LspServerInfo[],
  filePath: string,
  language?: string | null,
): ResolvedLspServer | null {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  const inferred = language ?? inferLanguage(filePath)
  const langLower = inferred.toLowerCase()
  const candidates = [langLower, ext].filter((v) => v && v !== 'text')
  if (candidates.length === 0) return null

  const enabledMatch = servers.find(
    (s) =>
      s.installStatus === 'installed' &&
      s.enabled &&
      candidates.some((c) => s.languages.includes(c)),
  )
  if (!enabledMatch) return null

  const staticTarget = resolveLspTarget(inferred !== 'text' ? inferred : ext)
  return {
    serverId: enabledMatch.id,
    languageId: staticTarget?.languageId ?? candidates[0] ?? 'plaintext',
    serverName: enabledMatch.serverName,
    serverLabel: enabledMatch.label,
  }
}

export async function resolveEnabledLspServer(
  filePath: string,
  language?: string | null,
): Promise<ResolvedLspServer | null> {
  if (typeof window.app?.listLspServers !== 'function') return null
  const servers = await window.app.listLspServers().catch(() => [])
  return matchEnabledServerFromList(servers, filePath, language)
}

export async function resolveEnabledLspServersForFiles(
  filePaths: readonly string[],
  workspaceRoot?: string | null,
): Promise<ResolvedLspServer[]> {
  if (typeof window.app?.listLspServers !== 'function') return []
  const servers = await window.app.listLspServers().catch(() => [])
  const byId = new Map<string, ResolvedLspServer>()

  for (const filePath of filePaths) {
    const matched = matchEnabledServerFromList(servers, filePath)
    if (matched && !byId.has(matched.serverId)) {
      byId.set(matched.serverId, matched)
    }
  }

  if (workspaceRoot) {
    const normalizedRoot = normalizeLspWorkspaceRoot(workspaceRoot)
    const prefix = `::${normalizedRoot}`
    for (const key of clientStatusMap.keys()) {
      if (!key.endsWith(prefix)) continue
      const serverId = key.slice(0, key.length - prefix.length)
      if (byId.has(serverId)) continue
      const info = servers.find(
        (s) => s.id === serverId && s.installStatus === 'installed' && s.enabled,
      )
      if (info) {
        byId.set(serverId, {
          serverId: info.id,
          languageId: info.languages[0] ?? 'plaintext',
          serverName: info.serverName,
          serverLabel: info.label,
        })
      }
    }
  }

  return Array.from(byId.values())
}
