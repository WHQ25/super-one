import { join, resolve, basename, sep } from 'path'
import log from './logger'
import { homedir } from 'os'
import { existsSync, readdirSync, readFileSync, statSync, cpSync, rmSync, type Dirent } from 'fs'
import type { ResourceScope, SkillInfo, SkillDetail, SkillFileEntry } from '@superone/shared/agent-types'
import { isPathWithinAllowed, isPathAtOrWithinAllowed } from './path-security'

export interface SkillDir {
  dir: string
  scope: ResourceScope
  namePrefix?: string
  readOnly?: boolean
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

function codexHome(): string {
  const envHome = process.env.CODEX_HOME?.trim()
  return envHome ? envHome : join(homedir(), '.codex')
}

export function getCodexSkillDirs(cwd: string): SkillDir[] {
  const home = codexHome()
  const dirs: SkillDir[] = [
    { dir: join(homedir(), '.agents', 'skills'), scope: 'user' },
    { dir: join(home, 'skills'), scope: 'user' },
    { dir: join(home, 'skills', '.system'), scope: 'user', readOnly: true },
  ]
  if (process.platform !== 'win32') {
    dirs.push({ dir: join('/etc', 'codex', 'skills'), scope: 'user', readOnly: true })
  }
  dirs.push(
    { dir: join(cwd, '.agents', 'skills'), scope: 'project' },
    { dir: join(cwd, '.codex', 'skills'), scope: 'project' },
  )
  return dirs
}

function parseFrontmatter(filePath: string): { name: string; description: string; argumentHint: string } {
  try {
    const content = readFileSync(filePath, 'utf-8')
    const match = content.match(/^---\s*\n([\s\S]*?)\n---/)
    if (!match) return { name: '', description: '', argumentHint: '' }
    const yaml = match[1]
    const name = yaml.match(/^name:\s*(.+)$/m)?.[1]?.trim() ?? ''
    const argumentHint =
      yaml.match(/^arguments:\s*(.+)$/m)?.[1]?.trim() ??
      yaml.match(/^argument-hint:\s*(.+)$/m)?.[1]?.trim() ??
      ''
    const lines = yaml.split('\n')
    let description = ''
    const descIdx = lines.findIndex(l => /^description:\s/.test(l))
    if (descIdx !== -1) {
      const inline = lines[descIdx].replace(/^description:\s*>?\s*/, '').trim()
      if (inline) {
        description = inline
      } else {
        const parts: string[] = []
        for (let i = descIdx + 1; i < lines.length; i++) {
          if (/^\s+/.test(lines[i])) parts.push(lines[i].trim())
          else break
        }
        description = parts.join(' ')
      }
    }
    return { name, description, argumentHint }
  } catch {
    return { name: '', description: '', argumentHint: '' }
  }
}

// Codex scans skill roots breadth-first up to MAX_SCAN_DEPTH directories deep
// (codex-rs/core-skills/src/loader.rs). Mirror that bound here so nested
// skills (e.g. `skills/category/my-skill/SKILL.md`) are discovered.
const MAX_SKILL_SCAN_DEPTH = 6

function isDirLike(dirPath: string, entry: { name: string; isDirectory: () => boolean; isSymbolicLink: () => boolean }): boolean {
  if (entry.isDirectory()) return true
  if (entry.isSymbolicLink()) {
    try {
      return statSync(join(dirPath, entry.name)).isDirectory()
    } catch {
      return false
    }
  }
  return false
}

// --- Core functions that accept SkillDir[] ---

export function listSkillsFromDirs(dirs: SkillDir[]): SkillInfo[] {
  const skills: SkillInfo[] = []
  const seen = new Set<string>()

  const walk = (root: string, relPrefix: string, depth: number, scope: ResourceScope, namePrefix?: string, readOnly?: boolean): void => {
    const absDir = relPrefix ? join(root, relPrefix) : root
    let entries: Dirent[]
    try {
      entries = readdirSync(absDir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      // Codex skips dot-prefixed entries during traversal; the embedded
      // `.system` root is scanned via its own SkillDir, not by descending here.
      if (entry.name.startsWith('.')) continue
      if (!isDirLike(absDir, entry)) continue
      const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name
      const skillDir = join(absDir, entry.name)
      if (existsSync(join(skillDir, 'SKILL.md'))) {
        const name = (namePrefix ?? '') + relPath
        const key = resolve(skillDir)
        if (!seen.has(key)) {
          seen.add(key)
          const fm = parseFrontmatter(join(skillDir, 'SKILL.md'))
          skills.push({
            name,
            displayName: fm.name || entry.name,
            scope,
            description: fm.description,
            argumentHint: fm.argumentHint,
            hasConfig: existsSync(join(skillDir, 'config.json')),
            sourcePath: skillDir,
            ...(readOnly ? { builtin: true } : {}),
          })
        }
      }
      if (depth + 1 < MAX_SKILL_SCAN_DEPTH) {
        walk(root, relPath, depth + 1, scope, namePrefix, readOnly)
      }
    }
  }

  for (const { dir, scope, namePrefix, readOnly } of dirs) {
    if (!existsSync(dir)) continue
    walk(dir, '', 0, scope, namePrefix, readOnly)
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

export function readSkillContentFromDirs(dirs: SkillDir[], name: string, sourcePath?: string): SkillDetail | null {
  for (const { dir, scope, namePrefix } of dirs) {
    // For plugin skills, strip the prefix to find the actual directory
    const dirName = namePrefix && name.startsWith(namePrefix) ? name.slice(namePrefix.length) : name
    const skillDir = join(dir, dirName)
    const skillMd = join(skillDir, 'SKILL.md')
    if (!existsSync(skillMd)) continue
    const expectedName = (namePrefix ?? '') + dirName
    if (expectedName !== name) continue
    // Disambiguate same-named skills living in different roots.
    if (sourcePath && resolve(skillDir) !== resolve(sourcePath)) continue
    const fm = parseFrontmatter(skillMd)
    return {
      name,
      displayName: fm.name || name,
      scope,
      description: fm.description,
      hasConfig: existsSync(join(skillDir, 'config.json')),
      // Echo back the caller's sourcePath so the detail's identity matches the
      // list item the renderer holds verbatim (the list value may be a non-byte-
      // identical but resolve-equal form, e.g. Codex RPC paths).
      sourcePath: sourcePath ?? skillDir,
      files: scanDir(skillDir),
    }
  }
  return null
}

export function readSkillFileFromDirs(dirs: SkillDir[], skillName: string, relativePath: string, sourcePath?: string): string | null {
  for (const { dir, namePrefix } of dirs) {
    const dirName = namePrefix && skillName.startsWith(namePrefix) ? skillName.slice(namePrefix.length) : skillName
    const skillDir = join(dir, dirName)
    if (!existsSync(join(skillDir, 'SKILL.md'))) continue
    const expectedName = (namePrefix ?? '') + dirName
    if (expectedName !== skillName) continue
    if (sourcePath && resolve(skillDir) !== resolve(sourcePath)) continue

    const resolved = resolve(skillDir, relativePath)
    // Prevent path traversal — require the resolved path to be the skill dir
    // itself or a descendant (the bare startsWith without a separator would let
    // a sibling sharing the dir's name as a prefix escape).
    if (resolved !== skillDir && !resolved.startsWith(skillDir + sep)) return null
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

export function readSkillContent(cwd: string, name: string, sourcePath?: string): SkillDetail | null {
  return readSkillContentFromDirs(getSkillDirs(cwd), name, sourcePath)
}

export function readSkillFile(cwd: string, skillName: string, relativePath: string, sourcePath?: string): string | null {
  return readSkillFileFromDirs(getSkillDirs(cwd), skillName, relativePath, sourcePath)
}

// --- Codex wrappers ---
// `listCodexSkills` removed: Codex skill listing now goes through the
// skills/list RPC (CodexSkillsRpcService). `readCodexSkillContent`,
// `readCodexSkillFile`, and `deleteCodexSkill` still scan local fs because
// the RPC only returns metadata + path, not file contents.

export function readCodexSkillContent(cwd: string, name: string, sourcePath?: string): SkillDetail | null {
  return readSkillContentFromDirs(getCodexSkillDirs(cwd), name, sourcePath)
}

export function readCodexSkillFile(cwd: string, skillName: string, relativePath: string, sourcePath?: string): string | null {
  return readSkillFileFromDirs(getCodexSkillDirs(cwd), skillName, relativePath, sourcePath)
}

// --- Install / Delete (Claude Code only) ---

export function installSkill(sourcePath: string): SkillInfo {
  const name = basename(sourcePath)
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
    sourcePath: dest,
  }
}

// Delete a skill by its exact on-disk directory (carried in SkillInfo.sourcePath).
// Reconstructing the path from name+scope is wrong when a same-named skill lives
// in a non-default root (e.g. Codex's ~/.codex/skills vs ~/.agents/skills) — the
// guessed path doesn't exist and the rm silently no-ops. We instead delete the
// real path, but only after validating it sits inside a writable, non-plugin,
// non-builtin skills root for this provider. Containment uses the shared
// path-security helpers (realpath + separator-aware) so symlinked homes resolve.
function deleteSkillBySourcePath(sourcePath: string, dirs: SkillDir[]): void {
  const target = resolve(sourcePath)
  const writableRoots = dirs.filter((d) => !d.readOnly && !d.namePrefix).map((d) => d.dir)
  const readOnlyRoots = dirs.filter((d) => d.readOnly).map((d) => d.dir)
  const allowed = isPathWithinAllowed(target, writableRoots) && !isPathAtOrWithinAllowed(target, readOnlyRoots)
  if (!allowed) {
    log.warn(`[skills] refusing to delete skill outside a writable root: ${sourcePath}`)
    return
  }
  if (!existsSync(join(target, 'SKILL.md'))) {
    log.warn(`[skills] refusing to delete: not a skill directory: ${sourcePath}`)
    return
  }
  rmSync(target, { recursive: true, force: true })
}

export function deleteSkill(sourcePath: string, cwd: string): void {
  deleteSkillBySourcePath(sourcePath, getSkillDirs(cwd))
}

export function deleteCodexSkill(sourcePath: string, cwd: string): void {
  deleteSkillBySourcePath(sourcePath, getCodexSkillDirs(cwd))
}
