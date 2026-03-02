import { join, resolve } from 'path'
import log from './logger'
import { homedir } from 'os'
import { existsSync, readdirSync, readFileSync, statSync, cpSync, rmSync } from 'fs'
import type { ResourceScope, SkillInfo, SkillDetail, SkillFileEntry } from '../shared/agent-types'

export interface SkillDir {
  dir: string
  scope: ResourceScope
  namePrefix?: string
}

function getSkillDirs(cwd: string): SkillDir[] {
  const dirs: SkillDir[] = [
    { dir: join(homedir(), '.claude', 'skills'), scope: 'user' },
    { dir: join(cwd, '.claude', 'skills'), scope: 'project' },
  ]

  // Plugin skills — user plugins → 'user', project/local plugins → 'project'
  const pluginsFile = join(homedir(), '.claude', 'plugins', 'installed_plugins.json')
  if (existsSync(pluginsFile)) {
    try {
      const data = JSON.parse(readFileSync(pluginsFile, 'utf-8'))
      const plugins: Record<string, Array<{ scope?: string; installPath?: string; projectPath?: string }>> = data.plugins ?? {}
      for (const [pluginKey, entries] of Object.entries(plugins)) {
        const pluginName = pluginKey.split('@')[0]
        for (const entry of entries) {
          if (!entry.installPath) continue
          const isProject = (entry.scope === 'project' || entry.scope === 'local') && entry.projectPath === cwd
          const isUser = entry.scope === 'user'
          if (!isUser && !isProject) continue
          dirs.push({
            dir: join(entry.installPath, 'skills'),
            scope: isUser ? 'user' : 'project',
            namePrefix: `${pluginName}:`,
          })
        }
      }
    } catch (err) { log.warn('[skills] failed to scan plugin dir:', err) }
  }

  return dirs
}

export function getCodexSkillDirs(cwd: string): SkillDir[] {
  return [
    { dir: join(homedir(), '.agents', 'skills'), scope: 'user' },
    { dir: join(cwd, '.agents', 'skills'), scope: 'project' },
  ]
}

function parseFrontmatter(filePath: string): { name: string; description: string } {
  try {
    const content = readFileSync(filePath, 'utf-8')
    const match = content.match(/^---\s*\n([\s\S]*?)\n---/)
    if (!match) return { name: '', description: '' }
    const yaml = match[1]
    const name = yaml.match(/^name:\s*(.+)$/m)?.[1]?.trim() ?? ''
    // Support both single-line and multi-line (> or |) description
    const lines = yaml.split('\n')
    let description = ''
    const descIdx = lines.findIndex(l => /^description:\s/.test(l))
    if (descIdx !== -1) {
      const inline = lines[descIdx].replace(/^description:\s*>?\s*/, '').trim()
      if (inline) {
        description = inline
      } else {
        // Collect indented continuation lines
        const parts: string[] = []
        for (let i = descIdx + 1; i < lines.length; i++) {
          if (/^\s+/.test(lines[i])) parts.push(lines[i].trim())
          else break
        }
        description = parts.join(' ')
      }
    }
    return { name, description }
  } catch {
    return { name: '', description: '' }
  }
}

// --- Core functions that accept SkillDir[] ---

export function listSkillsFromDirs(dirs: SkillDir[]): SkillInfo[] {
  const skills: SkillInfo[] = []
  const seen = new Set<string>()

  for (const { dir, scope, namePrefix } of dirs) {
    if (!existsSync(dir)) continue
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
      const skillMd = join(dir, entry.name, 'SKILL.md')
      if (!existsSync(skillMd)) continue
      const name = (namePrefix ?? '') + entry.name
      const key = `${scope}:${name}`
      if (seen.has(key)) continue
      seen.add(key)
      const fm = parseFrontmatter(skillMd)
      skills.push({
        name,
        displayName: fm.name || name,
        scope,
        description: fm.description,
        hasConfig: existsSync(join(dir, entry.name, 'config.json')),
      })
    }
  }

  return skills
}

function scanDir(dirPath: string): SkillFileEntry[] {
  try {
    return readdirSync(dirPath, { withFileTypes: true })
      .filter(e => !e.name.startsWith('.'))
      .sort((a, b) => {
        // Directories first, then files
        const aDir = a.isDirectory() || a.isSymbolicLink() && statSync(join(dirPath, a.name)).isDirectory()
        const bDir = b.isDirectory() || b.isSymbolicLink() && statSync(join(dirPath, b.name)).isDirectory()
        if (aDir !== bDir) return aDir ? -1 : 1
        return a.name.localeCompare(b.name)
      })
      .map(e => {
        const isDir = e.isDirectory() || (e.isSymbolicLink() && statSync(join(dirPath, e.name)).isDirectory())
        return {
          name: e.name,
          isDirectory: isDir,
          ...(isDir ? { children: scanDir(join(dirPath, e.name)) } : {}),
        }
      })
  } catch {
    return []
  }
}

export function readSkillContentFromDirs(dirs: SkillDir[], name: string): SkillDetail | null {
  for (const { dir, scope, namePrefix } of dirs) {
    // For plugin skills, strip the prefix to find the actual directory
    const dirName = namePrefix && name.startsWith(namePrefix) ? name.slice(namePrefix.length) : name
    const skillDir = join(dir, dirName)
    const skillMd = join(skillDir, 'SKILL.md')
    if (!existsSync(skillMd)) continue
    const expectedName = (namePrefix ?? '') + dirName
    if (expectedName !== name) continue
    const fm = parseFrontmatter(skillMd)
    return {
      name,
      displayName: fm.name || name,
      scope,
      description: fm.description,
      hasConfig: existsSync(join(skillDir, 'config.json')),
      files: scanDir(skillDir),
    }
  }
  return null
}

export function readSkillFileFromDirs(dirs: SkillDir[], skillName: string, relativePath: string): string | null {
  for (const { dir, namePrefix } of dirs) {
    const dirName = namePrefix && skillName.startsWith(namePrefix) ? skillName.slice(namePrefix.length) : skillName
    const skillDir = join(dir, dirName)
    if (!existsSync(join(skillDir, 'SKILL.md'))) continue
    const expectedName = (namePrefix ?? '') + dirName
    if (expectedName !== skillName) continue

    const resolved = resolve(skillDir, relativePath)
    // Prevent path traversal
    if (!resolved.startsWith(skillDir)) return null
    if (!existsSync(resolved) || statSync(resolved).isDirectory()) return null
    try {
      return readFileSync(resolved, 'utf-8')
    } catch {
      return null
    }
  }
  return null
}

// --- Claude Code wrappers (original API) ---

export function listSkills(cwd: string): SkillInfo[] {
  return listSkillsFromDirs(getSkillDirs(cwd))
}

export function readSkillContent(cwd: string, name: string): SkillDetail | null {
  return readSkillContentFromDirs(getSkillDirs(cwd), name)
}

export function readSkillFile(cwd: string, skillName: string, relativePath: string): string | null {
  return readSkillFileFromDirs(getSkillDirs(cwd), skillName, relativePath)
}

// --- Codex wrappers ---

export function listCodexSkills(cwd: string): SkillInfo[] {
  return listSkillsFromDirs(getCodexSkillDirs(cwd))
}

export function readCodexSkillContent(cwd: string, name: string): SkillDetail | null {
  return readSkillContentFromDirs(getCodexSkillDirs(cwd), name)
}

export function readCodexSkillFile(cwd: string, skillName: string, relativePath: string): string | null {
  return readSkillFileFromDirs(getCodexSkillDirs(cwd), skillName, relativePath)
}

// --- Install / Delete (Claude Code only) ---

export function installSkill(sourcePath: string): SkillInfo {
  const name = sourcePath.split('/').pop()!
  const dest = join(homedir(), '.claude', 'skills', name)
  cpSync(sourcePath, dest, { recursive: true })

  const skillMd = join(dest, 'SKILL.md')
  const fm = existsSync(skillMd) ? parseFrontmatter(skillMd) : { name: '', description: '' }
  return {
    name,
    displayName: fm.name || name,
    scope: 'user',
    description: fm.description,
    hasConfig: existsSync(join(dest, 'config.json')),
  }
}

function deleteSkillFromBaseDir(baseDirName: '.claude' | '.agents', name: string, scope: ResourceScope, cwd: string): void {
  const dir = scope === 'user'
    ? join(homedir(), baseDirName, 'skills', name)
    : join(cwd, baseDirName, 'skills', name)

  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true })
  }
}

export function deleteSkill(name: string, scope: ResourceScope, cwd: string): void {
  deleteSkillFromBaseDir('.claude', name, scope, cwd)
}

export function deleteCodexSkill(name: string, scope: ResourceScope, cwd: string): void {
  deleteSkillFromBaseDir('.agents', name, scope, cwd)
}
