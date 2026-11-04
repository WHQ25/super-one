import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { resolveArgumentHint } from '@superone/runtime/fs'
import type { SlashCommandInfo } from '@superone/shared/agent-types'

export const ANTIGRAVITY_BUILTIN_SLASH_COMMANDS: ReadonlyArray<SlashCommandInfo> = [
  {
    name: 'plan',
    description: 'Interactive mode for planning complex changes before execution',
    argumentHint: '',
    isSkill: false,
  },
  {
    name: 'compact',
    description: 'Compact or summarize conversation context to free up the context window',
    argumentHint: '',
    isSkill: false,
  },
  {
    name: 'goal',
    description: 'Run a thorough long-running task until the goal is fully achieved',
    argumentHint: '',
    isSkill: false,
  },
  {
    name: 'schedule',
    description: 'Run an instruction on a recurring schedule or set a one-time timer',
    argumentHint: '',
    isSkill: false,
  },
  {
    name: 'browser',
    description: 'Browse the web or interact with web applications',
    argumentHint: '',
    isSkill: false,
  },
  {
    name: 'grill-me',
    description: 'Align on a plan through an interactive interview to resolve design decisions',
    argumentHint: '',
    isSkill: false,
  },
  {
    name: 'teamwork',
    description: 'Coordinate a team of autonomous agents working together',
    argumentHint: '',
    isSkill: false,
  },
  {
    name: 'learn',
    description: 'Persist a learned correction or setup for future tasks',
    argumentHint: '',
    isSkill: false,
  },
  {
    name: 'boost',
    description: 'Deep thinking, strategic planning, and rigorous verification for complex tasks',
    argumentHint: '',
    isSkill: false,
  },
  {
    name: 'usage',
    description: 'Show model quota usage and reset times',
    argumentHint: '',
    isSkill: false,
  },
  {
    name: 'logout',
    description: 'Sign out and clear stored credentials',
    argumentHint: '',
    isSkill: false,
  },
]

const CLI_BUILTIN_SKILL_DIRS = ['agy-customizations', 'antigravity_guide'] as const
const WORKSPACE_SKILL_SUBDIRS = [
  ['.agents', 'skills'],
  ['.agent', 'skills'],
  ['_agents', 'skills'],
  ['_agent', 'skills'],
  ['.gemini', 'skills'],
] as const

export function parseSkillFrontmatter(content: string): Record<string, string> {
  if (!content.startsWith('---')) return {}
  const endIdx = content.indexOf('\n---', 3)
  if (endIdx === -1) return {}
  const lines = content.slice(4, endIdx).split('\n')
  const result: Record<string, string> = {}
  let blockKey: string | null = null
  let blockLines: string[] = []

  const flushBlock = () => {
    if (blockKey) {
      result[blockKey] = blockLines.join(' ').trim()
      blockKey = null
      blockLines = []
    }
  }

  for (const rawLine of lines) {
    if (blockKey) {
      if (/^\s+\S/.test(rawLine)) {
        blockLines.push(rawLine.trim())
        continue
      }
      if (!rawLine.trim()) continue
      flushBlock()
    }
    const match = rawLine.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/)
    if (!match) continue
    const key = match[1]!
    let val = match[2]!.trim()
    if (/^[>|][-+]?\s*$/.test(val)) {
      blockKey = key
      blockLines = []
      continue
    }
    if (/^(["'])(.*)\1$/.test(val)) val = val.slice(1, -1)
    result[key] = val
  }
  flushBlock()
  return result
}

function collectWorkspaceSkillDirs(rootPath: string): string[] {
  const dirs: string[] = []
  let current = resolve(rootPath)
  for (let depth = 0; depth < 12; depth += 1) {
    for (const rel of WORKSPACE_SKILL_SUBDIRS) {
      const candidate = join(current, ...rel)
      if (existsSync(candidate)) dirs.push(candidate)
    }
    if (existsSync(join(current, '.git'))) break
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return dirs
}

function collectGlobalSkillDirs(realHome: string, geminiHome?: string): string[] {
  const homes = new Set<string>()
  if (geminiHome?.trim()) homes.add(resolve(geminiHome.trim()))
  if (realHome.trim()) homes.add(resolve(realHome.trim(), '.gemini'))

  const dirs: string[] = []
  for (const gHome of homes) {
    const configSkills = join(gHome, 'config', 'skills')
    if (existsSync(configSkills)) dirs.push(configSkills)
    const cliSkills = join(gHome, 'antigravity-cli', 'skills')
    if (existsSync(cliSkills)) dirs.push(cliSkills)
    const pluginsRoot = join(gHome, 'config', 'plugins')
    if (existsSync(pluginsRoot)) {
      try {
        for (const pluginName of readdirSync(pluginsRoot)) {
          const pluginSkills = join(pluginsRoot, pluginName, 'skills')
          if (existsSync(pluginSkills)) dirs.push(pluginSkills)
        }
      } catch {
        void 0
      }
    }
  }
  if (realHome.trim()) {
    const dotAgentsSkills = join(realHome.trim(), '.agents', 'skills')
    if (existsSync(dotAgentsSkills)) dirs.push(dotAgentsSkills)
  }
  return dirs
}

function readSkillEntry(skillDir: string, fallbackName: string): SlashCommandInfo | null {
  const skillMd = join(skillDir, 'SKILL.md')
  if (!existsSync(skillMd)) return null
  let content = ''
  try {
    content = readFileSync(skillMd, 'utf8')
  } catch {
    return null
  }
  const fm = parseSkillFrontmatter(content)
  if (fm['disable-slash-command'] === 'true') return null
  const name = (fm.name || fallbackName).replace(/^\//, '').trim()
  if (!name) return null
  return {
    name,
    description: fm.description ?? '',
    argumentHint: resolveArgumentHint(fm),
    isSkill: true,
  }
}

export function discoverAntigravitySlashCommands(opts?: {
  cwd?: string | null
  additionalDirectories?: readonly string[]
  homeDir?: string
  geminiHome?: string
}): SlashCommandInfo[] {
  const realHome = opts?.homeDir ?? homedir()
  const out: SlashCommandInfo[] = [...ANTIGRAVITY_BUILTIN_SLASH_COMMANDS]
  const seen = new Set<string>(out.map((c) => c.name))

  const addSkillDirEntries = (skillsRoot: string) => {
    let entries: string[]
    try {
      entries = readdirSync(skillsRoot).sort()
    } catch {
      return
    }
    for (const entryName of entries) {
      if (entryName.startsWith('.')) continue
      const parsed = readSkillEntry(join(skillsRoot, entryName), entryName)
      if (!parsed || seen.has(parsed.name)) continue
      seen.add(parsed.name)
      out.push(parsed)
    }
  }

  const workspaceRoots = [
    ...(opts?.cwd?.trim() ? [opts.cwd.trim()] : []),
    ...(opts?.additionalDirectories ?? []),
  ]
  for (const root of workspaceRoots) {
    for (const dir of collectWorkspaceSkillDirs(root)) {
      addSkillDirEntries(dir)
    }
  }

  for (const dir of collectGlobalSkillDirs(realHome, opts?.geminiHome)) {
    addSkillDirEntries(dir)
  }

  const builtinRoot = join(realHome, '.gemini', 'antigravity-cli', 'builtin', 'skills')
  addSkillDirEntries(builtinRoot)
  for (const builtinName of CLI_BUILTIN_SKILL_DIRS) {
    const parsed = readSkillEntry(join(builtinRoot, builtinName), builtinName)
    if (!parsed || seen.has(parsed.name)) continue
    seen.add(parsed.name)
    out.push(parsed)
  }

  return out
}
