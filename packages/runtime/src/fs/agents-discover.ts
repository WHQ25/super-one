/**
 * Claude agent catalog discovery — electron-free.
 * Parity with desktop `discover-resources` agent functions.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir as osHomedir } from 'node:os'
import type { AgentInfo } from '@superone/shared/agent-types'
import { parseSimpleFrontmatter } from './skills-discover'

export interface AgentsDiscoverOptions {
  /** Override home (tests / node isolation). Default: os.homedir(). */
  homeDir?: string
}

function homeOf(opts?: AgentsDiscoverOptions): string {
  return opts?.homeDir ?? osHomedir()
}

function safeRead(path: string): string {
  try {
    return readFileSync(path, 'utf-8')
  } catch {
    return ''
  }
}

function extractDescription(content: string): string {
  const fm = parseSimpleFrontmatter(content)
  if (fm['description']) return fm['description']
  const body = content.startsWith('---')
    ? content.substring(content.indexOf('\n---', 3) + 4).trimStart()
    : content
  const firstLine = body.split('\n')[0] ?? ''
  return firstLine.replace(/^#+\s*/, '').trim()
}

/** Multi-line-aware frontmatter (agent files often use block descriptions). */
function parseFrontmatter(content: string): Record<string, string> {
  if (!content.startsWith('---')) return {}
  const endIdx = content.indexOf('\n---', 3)
  if (endIdx === -1) return {}
  const yaml = content.substring(4, endIdx)

  const result: Record<string, string> = {}
  const lines = yaml.split('\n')
  let currentKey = ''
  let currentValue = ''

  for (const line of lines) {
    if (currentKey && /^\s+\S/.test(line)) {
      currentValue += (currentValue ? ' ' : '') + line.trim()
      continue
    }
    if (currentKey) result[currentKey] = currentValue
    const match = line.match(/^([a-zA-Z_-]+):\s*(.*)$/)
    if (match) {
      currentKey = match[1]!
      const val = match[2]!.trim()
      if (/^[>|][-+]?\s*$/.test(val)) {
        currentValue = ''
      } else if (/^(["'])(.*)(\1)$/.test(val)) {
        currentValue = val.slice(1, -1)
      } else {
        currentValue = val
      }
    } else {
      currentKey = ''
      currentValue = ''
    }
  }
  if (currentKey) result[currentKey] = currentValue
  return result
}

interface PluginEntry {
  scope?: string
  installPath?: string
  projectPath?: string
}

type PluginMap = Record<string, PluginEntry[]>

function readPlugins(opts?: AgentsDiscoverOptions): PluginMap {
  const pluginsFile = join(homeOf(opts), '.claude', 'plugins', 'installed_plugins.json')
  if (!existsSync(pluginsFile)) return {}
  try {
    const data = JSON.parse(readFileSync(pluginsFile, 'utf-8')) as { plugins?: PluginMap }
    return data.plugins ?? {}
  } catch {
    return {}
  }
}

function isUserScoped(entry: PluginEntry): boolean {
  return entry.scope === 'user'
}

function isProjectScoped(entry: PluginEntry, cwd: string): boolean {
  return (entry.scope === 'project' || entry.scope === 'local') && entry.projectPath === cwd
}

function forEachPluginScope(
  filter: (entry: PluginEntry) => boolean,
  callback: (installPath: string, pluginName: string) => void,
  opts?: AgentsDiscoverOptions,
): void {
  for (const [pluginKey, entries] of Object.entries(readPlugins(opts))) {
    const pluginName = pluginKey.split('@')[0] ?? pluginKey
    for (const entry of entries) {
      if (entry.installPath && filter(entry)) callback(entry.installPath, pluginName)
    }
  }
}

function scanAgentDir(dir: string, source: AgentInfo['source'], namePrefix = ''): AgentInfo[] {
  if (!existsSync(dir)) return []
  const agents: AgentInfo[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    const name = namePrefix + entry.name.replace(/\.md$/, '')
    const content = safeRead(join(dir, entry.name))
    const fm = parseFrontmatter(content)
    agents.push({
      name,
      description: fm['description'] ?? extractDescription(content),
      model: fm['model'] || undefined,
      source,
    })
  }
  return agents
}

/** Discover user-level agents (~/.claude/agents + user-scoped plugin agents). */
export function discoverUserAgents(opts?: AgentsDiscoverOptions): AgentInfo[] {
  const agents: AgentInfo[] = [
    ...scanAgentDir(join(homeOf(opts), '.claude', 'agents'), 'user'),
  ]
  forEachPluginScope(
    isUserScoped,
    (installPath, pluginName) => {
      agents.push(...scanAgentDir(join(installPath, 'agents'), 'plugin', `${pluginName}:`))
    },
    opts,
  )
  return agents
}

/** Discover project-level agents ({cwd}/.claude/agents + project-scoped plugin agents). */
export function discoverProjectAgents(cwd: string, opts?: AgentsDiscoverOptions): AgentInfo[] {
  const agents: AgentInfo[] = [...scanAgentDir(join(cwd, '.claude', 'agents'), 'project')]
  forEachPluginScope(
    (e) => isProjectScoped(e, cwd),
    (installPath, pluginName) => {
      agents.push(...scanAgentDir(join(installPath, 'agents'), 'plugin', `${pluginName}:`))
    },
    opts,
  )
  return agents
}

/** Discover all agents (user + project), deduped by name, with scope tag. */
export function discoverAllAgents(
  cwd: string,
  opts?: AgentsDiscoverOptions,
): (AgentInfo & { scope: 'user' | 'project' })[] {
  const seen = new Set<string>()
  const result: (AgentInfo & { scope: 'user' | 'project' })[] = []
  for (const a of discoverProjectAgents(cwd, opts)) {
    if (seen.has(a.name)) continue
    seen.add(a.name)
    result.push({ ...a, scope: 'project' })
  }
  for (const a of discoverUserAgents(opts)) {
    if (seen.has(a.name)) continue
    seen.add(a.name)
    result.push({ ...a, scope: 'user' })
  }
  return result
}

/** Read the .md content of an agent by name. Checks project → user → plugins. */
export function readAgentFile(
  cwd: string,
  name: string,
  opts?: AgentsDiscoverOptions,
): string | null {
  const baseName = name.includes(':') ? name.split(':').pop()! : name

  const projectPath = join(cwd, '.claude', 'agents', `${baseName}.md`)
  if (existsSync(projectPath)) return safeRead(projectPath) || null

  const userPath = join(homeOf(opts), '.claude', 'agents', `${baseName}.md`)
  if (existsSync(userPath)) return safeRead(userPath) || null

  const plugins = readPlugins(opts)
  for (const [pluginKey, entries] of Object.entries(plugins)) {
    const pluginName = pluginKey.split('@')[0] ?? pluginKey
    for (const entry of entries) {
      if (!entry.installPath) continue
      const prefix = `${pluginName}:`
      const agentBaseName = name.startsWith(prefix) ? name.slice(prefix.length) : baseName
      const pluginAgentPath = join(entry.installPath, 'agents', `${agentBaseName}.md`)
      if (existsSync(pluginAgentPath)) return safeRead(pluginAgentPath) || null
    }
  }

  return null
}
