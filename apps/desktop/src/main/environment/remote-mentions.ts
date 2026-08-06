/**
 * Remote @-mention / file search / skill list / agents catalog via node workspace RPC.
 */

import type {
  AgentInfo,
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

/**
 * Remote agents catalog via `agents.list` (mirrors listRemoteSkillsAndCommands).
 * Returns null when the path is not a remote project; empty array on RPC failure.
 */
export async function listRemoteAgents(
  host: EnvironmentHost,
  folderPath: string,
): Promise<Array<AgentInfo & { scope: 'user' | 'project' }> | null> {
  const ctx = await resolveRemoteProjectContext(host, folderPath)
  if (!ctx) return null
  const gw = asRemoteGw(host, ctx.environmentId)
  if (!gw) return []
  try {
    const result = await gw.agentsList(ctx.projectId)
    const agents = Array.isArray(result?.agents) ? result.agents : []
    return agents
      .filter(
        (a): a is {
          name: string
          description: string
          model?: string
          source: AgentInfo['source']
          scope: 'user' | 'project'
        } =>
          !!a &&
          typeof a.name === 'string' &&
          (a.scope === 'user' || a.scope === 'project') &&
          (a.source === 'user' || a.source === 'project' || a.source === 'plugin'),
      )
      .map((a) => ({
        name: a.name,
        description: typeof a.description === 'string' ? a.description : '',
        model: typeof a.model === 'string' ? a.model : undefined,
        source: a.source,
        scope: a.scope,
      }))
  } catch {
    return []
  }
}

/**
 * Read a remote agent markdown file via `agents.readFile`.
 * Returns null when not remote; empty string when missing/failed (local parity).
 */
export async function readRemoteAgentFile(
  host: EnvironmentHost,
  folderPath: string,
  name: string,
): Promise<string | null> {
  const ctx = await resolveRemoteProjectContext(host, folderPath)
  if (!ctx) return null
  const gw = asRemoteGw(host, ctx.environmentId)
  if (!gw) return ''
  try {
    const result = await gw.agentsReadFile(ctx.projectId, name)
    return typeof result?.content === 'string' ? result.content : ''
  } catch {
    return ''
  }
}
