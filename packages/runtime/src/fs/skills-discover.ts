import { existsSync, readdirSync, readFileSync, type Dirent } from 'node:fs'
import { join } from 'node:path'

export interface ClaudeSkillInfo {
  name: string
  description: string
  argumentHint: string
  isSkill: boolean
  scope: 'user' | 'project'
}

function safeReadText(path: string): string {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

/** Minimal YAML frontmatter for SKILL.md / command markdown. */
export function parseSimpleFrontmatter(content: string): Record<string, string> {
  if (!content.startsWith('---')) return {}
  const endIdx = content.indexOf('\n---', 3)
  if (endIdx === -1) return {}
  const yaml = content.slice(4, endIdx)
  const result: Record<string, string> = {}
  for (const line of yaml.split('\n')) {
    const match = line.match(/^([a-zA-Z_-]+):\s*(.*)$/)
    if (!match) continue
    let val = match[2]!.trim()
    if (/^(["'])(.*)\1$/.test(val)) val = val.slice(1, -1)
    if (/^[>|][-+]?\s*$/.test(val)) val = ''
    result[match[1]!] = val
  }
  return result
}

/**
 * Claude Code uses `arguments:`; Grok uses `argument-hint:`.
 * Accept either so slash menus show a hint regardless of skill author convention.
 * When both are set, prefer `arguments` (Claude / SuperOne historical order).
 */
export function resolveArgumentHint(
  fm: Record<string, string | undefined | null> | null | undefined,
): string {
  if (!fm) return ''
  const fromArguments = (fm.arguments ?? '').trim()
  if (fromArguments) return fromArguments
  return (fm['argument-hint'] ?? '').trim()
}

/** Read skill/command markdown and resolve Claude `arguments` or Grok `argument-hint`. */
export function readArgumentHintFromMarkdownFile(filePath: string): string {
  try {
    return resolveArgumentHint(parseSimpleFrontmatter(safeReadText(filePath)))
  } catch {
    return ''
  }
}

function firstMarkdownHeading(content: string): string {
  for (const line of content.split('\n')) {
    const m = line.match(/^#\s+(.+)$/)
    if (m) return m[1]!.trim()
  }
  return ''
}

/**
 * Discover Claude skills + slash commands under a project root and optional home.
 * User dirs first then project so project can override by name (seen set).
 */
export function discoverClaudeSkillsAndCommands(
  projectRoot: string,
  opts?: { homeDir?: string | null },
): { skills: ClaudeSkillInfo[]; commands: ClaudeSkillInfo[] } {
  const skills: ClaudeSkillInfo[] = []
  const commands: ClaudeSkillInfo[] = []
  const seenSkills = new Set<string>()
  const seenCommands = new Set<string>()

  const scanSkills = (dir: string, scope: 'user' | 'project') => {
    if (!existsSync(dir)) return
    let ents: Dirent[]
    try {
      ents = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const ent of ents) {
      if (!ent.isDirectory()) continue
      const skillMd = join(dir, ent.name, 'SKILL.md')
      if (!existsSync(skillMd)) continue
      if (seenSkills.has(ent.name)) continue
      seenSkills.add(ent.name)
      const fm = parseSimpleFrontmatter(safeReadText(skillMd))
      skills.push({
        name: ent.name,
        description: fm.description ?? '',
        argumentHint: resolveArgumentHint(fm),
        isSkill: true,
        scope,
      })
    }
  }

  const scanCommands = (dir: string, scope: 'user' | 'project') => {
    if (!existsSync(dir)) return
    let ents: Dirent[]
    try {
      ents = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const ent of ents) {
      if (!ent.isFile() || !ent.name.endsWith('.md')) continue
      const name = ent.name.replace(/\.md$/, '')
      if (seenCommands.has(name)) continue
      seenCommands.add(name)
      const content = safeReadText(join(dir, ent.name))
      const fm = parseSimpleFrontmatter(content)
      commands.push({
        name,
        description: fm.description ?? firstMarkdownHeading(content),
        argumentHint: resolveArgumentHint(fm),
        isSkill: false,
        scope,
      })
    }
  }

  const home =
    opts?.homeDir === undefined
      ? process.env.HOME || process.env.USERPROFILE || ''
      : opts.homeDir || ''
  if (home) {
    scanSkills(join(home, '.claude', 'skills'), 'user')
    scanCommands(join(home, '.claude', 'commands'), 'user')
  }
  scanSkills(join(projectRoot, '.claude', 'skills'), 'project')
  scanSkills(join(projectRoot, '.agents', 'skills'), 'project')
  scanCommands(join(projectRoot, '.claude', 'commands'), 'project')

  return { skills, commands }
}
