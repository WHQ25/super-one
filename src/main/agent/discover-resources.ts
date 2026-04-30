import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { AgentInfo, SlashCommandInfo } from '../../shared/agent-types'

// --- YAML frontmatter parser ---

/** Parse simple YAML frontmatter (--- delimited) into key-value pairs. */
function parseFrontmatter(content: string): Record<string, string> {
  if (!content.startsWith('---')) return {}
  const endIdx = content.indexOf('\n---', 3)
  if (endIdx === -1) return {}
  const yaml = content.substring(4, endIdx) // skip "---\n"

  const result: Record<string, string> = {}
  const lines = yaml.split('\n')
  let currentKey = ''
  let currentValue = ''

  for (const line of lines) {
    // Continuation line (indented, part of multi-line value)
    if (currentKey && /^\s+\S/.test(line)) {
      currentValue += (currentValue ? ' ' : '') + line.trim()
      continue
    }
    // Save accumulated value
    if (currentKey) result[currentKey] = currentValue
    // New key: value pair
    const match = line.match(/^([a-zA-Z_-]+):\s*(.*)$/)
    if (match) {
      currentKey = match[1]
      const val = match[2].trim()
      // Handle YAML block scalar indicators (>, |, >-, |-)
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

/** Read file content safely, returning empty string on failure. */
function safeRead(path: string): string {
  try {
    return readFileSync(path, 'utf-8')
  } catch {
    return ''
  }
}

// --- Plugin helpers ---

interface PluginEntry {
  scope?: string
  installPath?: string
  projectPath?: string
}

type PluginMap = Record<string, PluginEntry[]>

function readPlugins(): PluginMap {
  const pluginsFile = join(homedir(), '.claude', 'plugins', 'installed_plugins.json')
  if (!existsSync(pluginsFile)) return {}
  try {
    const data = JSON.parse(readFileSync(pluginsFile, 'utf-8'))
    return (data.plugins as PluginMap) ?? {}
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

/** Iterate over installed plugins matching `filter`, invoking `callback(installPath, pluginName)`. */
function forEachPluginScope(
  filter: (entry: PluginEntry) => boolean,
  callback: (installPath: string, pluginName: string) => void,
): void {
  for (const [pluginKey, entries] of Object.entries(readPlugins())) {
    const pluginName = pluginKey.split('@')[0]
    for (const entry of entries) {
      if (entry.installPath && filter(entry)) callback(entry.installPath, pluginName)
    }
  }
}

// --- Skill discovery ---

/**
 * Scan a skills directory and return SlashCommandInfo entries.
 * Reads SKILL.md frontmatter for `description` and `argument-hint`.
 */
function scanSkillDir(dir: string): SlashCommandInfo[] {
  if (!existsSync(dir)) return []
  const skills: SlashCommandInfo[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const skillMd = join(dir, entry.name, 'SKILL.md')
    if (!existsSync(skillMd)) continue
    const fm = parseFrontmatter(safeRead(skillMd))
    skills.push({
      name: entry.name,
      description: fm['description'] ?? '',
      argumentHint: fm['arguments'] ?? fm['argument-hint'] ?? '',
      isSkill: true,
    })
  }
  return skills
}

function discoverPluginSkills(filter: (entry: PluginEntry) => boolean): SlashCommandInfo[] {
  const skills: SlashCommandInfo[] = []
  forEachPluginScope(filter, (installPath) => {
    skills.push(...scanSkillDir(join(installPath, 'skills')))
  })
  return skills
}

/** Discover user-level skills (~/.claude/skills + user-scoped plugins). */
export function discoverUserSkills(): SlashCommandInfo[] {
  return [
    ...scanSkillDir(join(homedir(), '.claude', 'skills')),
    ...discoverPluginSkills(isUserScoped),
  ]
}

/** Discover project-level skills ({cwd}/.claude/skills + project-scoped plugins). */
export function discoverProjectSkills(cwd: string): SlashCommandInfo[] {
  return [
    ...scanSkillDir(join(cwd, '.claude', 'skills')),
    ...discoverPluginSkills((e) => isProjectScoped(e, cwd)),
  ]
}

/** Discover all skills (user + project), deduped by name. */
export function discoverSkills(cwd: string): SlashCommandInfo[] {
  const seen = new Set<string>()
  const result: SlashCommandInfo[] = []
  for (const skill of [...discoverUserSkills(), ...discoverProjectSkills(cwd)]) {
    if (seen.has(skill.name)) continue
    seen.add(skill.name)
    result.push(skill)
  }
  return result
}

// --- Command discovery ---

/**
 * Scan a commands directory and return SlashCommandInfo entries.
 * Reads YAML frontmatter for `description` and `argument-hint`.
 * Falls back to the first `# heading` line as description if no frontmatter.
 */
export function scanCommandDir(dir: string, namePrefix = ''): SlashCommandInfo[] {
  if (!existsSync(dir)) return []
  const commands: SlashCommandInfo[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    const name = namePrefix + entry.name.replace(/\.md$/, '')
    const content = safeRead(join(dir, entry.name))
    const fm = parseFrontmatter(content)
    commands.push({
      name,
      description: fm['description'] ?? extractDescription(content),
      argumentHint: fm['argument-hint'] ?? '',
      isSkill: false,
    })
  }
  return commands
}

/** Discover Codex user-level prompts (~/.codex/prompts/*.md, top-level only). */
export function discoverCodexUserPrompts(): SlashCommandInfo[] {
  return scanCommandDir(join(homedir(), '.codex', 'prompts'))
}

/** Discover user-level slash commands (~/.claude/commands + user-scoped plugin commands). */
export function discoverUserCommands(): SlashCommandInfo[] {
  const commands: SlashCommandInfo[] = [...scanCommandDir(join(homedir(), '.claude', 'commands'))]
  forEachPluginScope(isUserScoped, (installPath, pluginName) => {
    commands.push(...scanCommandDir(join(installPath, 'commands'), `${pluginName}:`))
  })
  return commands
}

// --- Common helpers ---

/** Extract description from a .md file: frontmatter `description` field, or first heading/line. */
function extractDescription(content: string): string {
  const fm = parseFrontmatter(content)
  if (fm['description']) return fm['description']
  const body = content.startsWith('---')
    ? content.substring(content.indexOf('\n---', 3) + 4).trimStart()
    : content
  const firstLine = body.split('\n')[0] ?? ''
  return firstLine.replace(/^#+\s*/, '').trim()
}

// --- Agent discovery ---

/** Scan a directory for .md agent files and return AgentInfo entries. */
function scanAgentDir(dir: string, source: AgentInfo['source'], namePrefix = ''): AgentInfo[] {
  if (!existsSync(dir)) return []
  const agents: AgentInfo[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    const name = namePrefix + entry.name.replace(/\.md$/, '')
    const content = safeRead(join(dir, entry.name))
    const fm = parseFrontmatter(content)
    agents.push({ name, description: fm['description'] ?? extractDescription(content), model: fm['model'] || undefined, source })
  }
  return agents
}

/** Discover user-level agents (~/.claude/agents + user-scoped plugin agents). */
export function discoverUserAgents(): AgentInfo[] {
  const agents: AgentInfo[] = [...scanAgentDir(join(homedir(), '.claude', 'agents'), 'user')]
  forEachPluginScope(isUserScoped, (installPath, pluginName) => {
    agents.push(...scanAgentDir(join(installPath, 'agents'), 'plugin', `${pluginName}:`))
  })
  return agents
}

/** Discover project-level agents ({cwd}/.claude/agents + project-scoped plugin agents). */
export function discoverProjectAgents(cwd: string): AgentInfo[] {
  const agents: AgentInfo[] = [...scanAgentDir(join(cwd, '.claude', 'agents'), 'project')]
  forEachPluginScope((e) => isProjectScoped(e, cwd), (installPath, pluginName) => {
    agents.push(...scanAgentDir(join(installPath, 'agents'), 'plugin', `${pluginName}:`))
  })
  return agents
}

/** Discover all agents (user + project), deduped by name, with scope tag. */
export function discoverAllAgents(cwd: string): (AgentInfo & { scope: 'user' | 'project' })[] {
  const seen = new Set<string>()
  const result: (AgentInfo & { scope: 'user' | 'project' })[] = []
  // Project agents first (higher priority in UI)
  for (const a of discoverProjectAgents(cwd)) {
    if (seen.has(a.name)) continue
    seen.add(a.name)
    result.push({ ...a, scope: 'project' })
  }
  for (const a of discoverUserAgents()) {
    if (seen.has(a.name)) continue
    seen.add(a.name)
    result.push({ ...a, scope: 'user' })
  }
  return result
}

/** Read the .md content of an agent by name. Checks project → user → plugins. */
export function readAgentFile(cwd: string, name: string): string | null {
  // Strip plugin prefix for path resolution
  const baseName = name.includes(':') ? name.split(':').pop()! : name

  // 1. Project-level
  const projectPath = join(cwd, '.claude', 'agents', `${baseName}.md`)
  if (existsSync(projectPath)) return safeRead(projectPath) || null

  // 2. User-level
  const userPath = join(homedir(), '.claude', 'agents', `${baseName}.md`)
  if (existsSync(userPath)) return safeRead(userPath) || null

  // 3. Plugin agents (search by full name including prefix)
  const plugins = readPlugins()
  for (const [pluginKey, entries] of Object.entries(plugins)) {
    const pluginName = pluginKey.split('@')[0]
    for (const entry of entries) {
      if (!entry.installPath) continue
      // Match: "pluginName:baseName" or just baseName in plugin dir
      const prefix = `${pluginName}:`
      const agentBaseName = name.startsWith(prefix) ? name.slice(prefix.length) : baseName
      const pluginAgentPath = join(entry.installPath, 'agents', `${agentBaseName}.md`)
      if (existsSync(pluginAgentPath)) return safeRead(pluginAgentPath) || null
    }
  }

  return null
}

/** Discover project-level slash commands ({cwd}/.claude/commands + project-scoped plugin commands). */
export function discoverProjectCommands(cwd: string): SlashCommandInfo[] {
  const commands: SlashCommandInfo[] = [...scanCommandDir(join(cwd, '.claude', 'commands'))]
  forEachPluginScope((e) => isProjectScoped(e, cwd), (installPath, pluginName) => {
    commands.push(...scanCommandDir(join(installPath, 'commands'), `${pluginName}:`))
  })
  return commands
}
