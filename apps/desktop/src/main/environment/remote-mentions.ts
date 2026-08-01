/**
 * Remote @-mention / file search / skill list via node workspace RPC.
 */

import type {
  FileSearchResult,
  ListDirEntry,
  MentionSearchItem,
  SlashCommandInfo,
} from '@superone/shared/agent-types'
import {
  EXCLUDED_DIRS,
  searchFilesInEntries,
  searchMentionsInEntries,
  type AgentEntry,
} from '@superone/runtime/fs'
import type { EnvironmentHost } from './environment-host'
import { RemoteEnvironmentGateway } from './remote-environment-gateway'
import { resolveRemoteProjectContext } from './remote-file-tree'

function asRemoteGw(host: EnvironmentHost, environmentId: string): RemoteEnvironmentGateway | null {
  const gw = host.getGateway(environmentId)
  return gw instanceof RemoteEnvironmentGateway ? gw : null
}

/** Browse-mode @ popup: one directory of children (not recursive). */
export async function listRemoteDirectoryForMentions(
  host: EnvironmentHost,
  folderPath: string,
  relativePath: string,
): Promise<ListDirEntry[] | null> {
  const ctx = await resolveRemoteProjectContext(host, folderPath)
  if (!ctx) return null
  const rel = relativePath.trim() === '' ? '.' : relativePath.replace(/\\/g, '/')
  try {
    const entries = await host.workspace().listDir({
      project: { environmentId: ctx.environmentId, projectId: ctx.projectId },
      relativePath: rel,
    })
    const result: ListDirEntry[] = []
    for (const e of entries) {
      if (EXCLUDED_DIRS.has(e.name) || e.name === '.DS_Store') continue
      result.push({
        name: e.name,
        isDirectory: e.type === 'directory',
      })
    }
    result.sort((a, b) =>
      a.isDirectory !== b.isDirectory
        ? a.isDirectory
          ? -1
          : 1
        : a.name.localeCompare(b.name),
    )
    return result
  } catch {
    return []
  }
}

async function fetchRemoteFileInventory(
  host: EnvironmentHost,
  folderPath: string,
  scopeDir?: string,
): Promise<Array<{ path: string; isDirectory: boolean }> | null> {
  const ctx = await resolveRemoteProjectContext(host, folderPath)
  if (!ctx) return null
  const gw = asRemoteGw(host, ctx.environmentId)
  if (!gw) return []
  try {
    const relativePath =
      scopeDir && scopeDir.trim()
        ? scopeDir.replace(/\\/g, '/').replace(/\/$/, '')
        : undefined
    const result = await gw.workspaceListFiles(ctx.projectId, {
      relativePath,
      maxDepth: 10,
      maxFiles: 20_000,
    })
    const files = Array.isArray(result?.files) ? result.files : []
    return files
      .filter((f) => f && typeof f.path === 'string')
      .map((f) => ({
        path: f.path.replace(/\\/g, '/'),
        isDirectory: Boolean(f.isDirectory),
      }))
  } catch {
    return []
  }
}

export async function searchRemoteMentions(
  host: EnvironmentHost,
  folderPath: string,
  query: string,
  agents: AgentEntry[],
  scopeDir?: string,
  limit = 20,
): Promise<MentionSearchItem[] | null> {
  const inventory = await fetchRemoteFileInventory(host, folderPath, scopeDir)
  if (inventory === null) return null
  return searchMentionsInEntries(inventory, query, agents, limit, scopeDir)
}

export async function searchRemoteFiles(
  host: EnvironmentHost,
  folderPath: string,
  query: string,
  limit = 20,
): Promise<FileSearchResult[] | null> {
  const inventory = await fetchRemoteFileInventory(host, folderPath)
  if (inventory === null) return null
  return searchFilesInEntries(inventory, query, limit)
}

export async function listRemoteSkillsAndCommands(
  host: EnvironmentHost,
  folderPath: string,
): Promise<{ skills: SlashCommandInfo[]; commands: SlashCommandInfo[] } | null> {
  const ctx = await resolveRemoteProjectContext(host, folderPath)
  if (!ctx) return null
  const gw = asRemoteGw(host, ctx.environmentId)
  if (!gw) return { skills: [], commands: [] }
  try {
    const result = await gw.workspaceListSkills(ctx.projectId)
    const mapOne = (row: {
      name?: string
      description?: string
      argumentHint?: string
      isSkill?: boolean
    }): SlashCommandInfo | null => {
      if (!row?.name || typeof row.name !== 'string') return null
      return {
        name: row.name,
        description: typeof row.description === 'string' ? row.description : '',
        argumentHint: typeof row.argumentHint === 'string' ? row.argumentHint : '',
        isSkill: row.isSkill !== false,
      }
    }
    const skills = (result?.skills ?? [])
      .map(mapOne)
      .filter((x): x is SlashCommandInfo => x != null)
      .map((s) => ({ ...s, isSkill: true }))
    const commands = (result?.commands ?? [])
      .map(mapOne)
      .filter((x): x is SlashCommandInfo => x != null)
      .map((c) => ({ ...c, isSkill: false }))
    return { skills, commands }
  } catch {
    return { skills: [], commands: [] }
  }
}
