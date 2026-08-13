/**
 * Scan Cursor skills / commands from disk for the SuperOne slash popup.
 * The SDK loads these into the agent via settingSources; it does not return a catalog.
 */

import { existsSync, readdirSync, readFileSync, type Dirent } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseSimpleFrontmatter, resolveArgumentHint } from '@superone/runtime/fs'
import type { SlashCommandInfo } from '@superone/shared/agent-types'

function safeReadText(path: string): string {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

function firstMarkdownHeading(content: string): string {
  for (const line of content.split('\n')) {
    const match = line.match(/^#\s+(.+)$/)
    if (match) return match[1]!.trim()
  }
  return ''
}

/** Drop YAML frontmatter so `.cursor/commands` can be pasted as a prompt. */
export function stripMarkdownFrontmatter(content: string): string {
  if (!content.startsWith('---')) return content.trim()
  const endIdx = content.indexOf('\n---', 3)
  if (endIdx === -1) return content.trim()
  return content.slice(endIdx + 4).replace(/^\r?\n/, '').trim()
}

function listDirents(dir: string): Dirent[] {
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

/**
 * Discover Cursor slash catalog entries under project + user `.cursor` dirs.
 * Project entries override the same name from the user dir.
 */
export function discoverCursorSkillsAndCommands(
  projectRoot: string,
  opts?: { homeDir?: string | null },
): SlashCommandInfo[] {
  const items: SlashCommandInfo[] = []
  const seenSkills = new Set<string>()
  const seenCommands = new Set<string>()

  const scanSkills = (dir: string) => {
    for (const ent of listDirents(dir)) {
      if (!ent.isDirectory()) continue
      const skillMd = join(dir, ent.name, 'SKILL.md')
      if (!existsSync(skillMd)) continue
      if (seenSkills.has(ent.name)) continue
      seenSkills.add(ent.name)
      const fm = parseSimpleFrontmatter(safeReadText(skillMd))
      items.push({
        name: ent.name,
        description: fm.description ?? '',
        argumentHint: resolveArgumentHint(fm),
        isSkill: true,
      })
    }
  }

  const scanCommands = (dir: string) => {
    for (const ent of listDirents(dir)) {
      if (!ent.isFile() || !ent.name.endsWith('.md')) continue
      const name = ent.name.replace(/\.md$/, '')
      if (seenCommands.has(name)) continue
      seenCommands.add(name)
      const content = safeReadText(join(dir, ent.name))
      const fm = parseSimpleFrontmatter(content)
      items.push({
        name,
        description: fm.description ?? firstMarkdownHeading(content),
        argumentHint: resolveArgumentHint(fm),
        isSkill: false,
        promptBody: stripMarkdownFrontmatter(content),
      })
    }
  }

  const home =
    opts?.homeDir === undefined
      ? homedir()
      : opts.homeDir || ''

  // Project first so it overrides the same user-level name.
  scanSkills(join(projectRoot, '.cursor', 'skills'))
  scanCommands(join(projectRoot, '.cursor', 'commands'))
  if (home) {
    scanSkills(join(home, '.cursor', 'skills'))
    scanCommands(join(home, '.cursor', 'commands'))
  }

  return items
}
