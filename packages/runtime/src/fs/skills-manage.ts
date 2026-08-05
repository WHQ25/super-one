/**
 * Electron-free skill management (list / read / install / delete).
 * Behavioral parity with desktop `skills-service` for Claude + Codex roots.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  type Dirent,
} from 'node:fs'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { homedir as osHomedir } from 'node:os'
import type { ResourceScope, SkillDetail, SkillFileEntry, SkillInfo } from '@superone/shared/agent-types'
import type { ResourceProvider } from '@superone/shared/environment'
import { isPathAtOrWithinAllowed, isPathWithinAllowed } from './path-security'
import { parseSimpleFrontmatter } from './skills-discover'

export interface SkillDir {
  dir: string
  scope: Extract<ResourceScope, 'user' | 'project'>
  namePrefix?: string
  readOnly?: boolean
}

export interface SkillsManageOptions {
  /** Override home (tests / node isolation). Default: os.homedir(). */
  homeDir?: string
  /** Override CODEX_HOME. */
  codexHome?: string
}

const MAX_SKILL_SCAN_DEPTH = 6
const MAX_INSTALL_FILE_BYTES = 2 * 1024 * 1024
const MAX_INSTALL_FILES = 64

function homeOf(opts?: SkillsManageOptions): string {
  return opts?.homeDir ?? osHomedir()
}

function codexHomeOf(opts?: SkillsManageOptions): string {
  if (opts?.codexHome) return opts.codexHome
  const env = process.env.CODEX_HOME?.trim()
  return env || join(homeOf(opts), '.codex')
}

function parseFrontmatterFile(filePath: string): {
  name: string
  description: string
  argumentHint: string
} {
  try {
    const content = readFileSync(filePath, 'utf8')
    const fm = parseSimpleFrontmatter(content)
    // Multi-line description: fall back to full frontmatter regex like desktop.
    let description = fm.description ?? ''
    if (!description && content.startsWith('---')) {
      const match = content.match(/^---\s*\n([\s\S]*?)\n---/)
      if (match) {
        const lines = match[1]!.split('\n')
        const descIdx = lines.findIndex((l) => /^description:\s/.test(l))
        if (descIdx !== -1) {
          const inline = lines[descIdx]!.replace(/^description:\s*>?\s*/, '').trim()
          if (inline) description = inline
          else {
            const parts: string[] = []
            for (let i = descIdx + 1; i < lines.length; i++) {
              if (/^\s+/.test(lines[i]!)) parts.push(lines[i]!.trim())
              else break
            }
            description = parts.join(' ')
          }
        }
      }
    }
    return {
      name: fm.name ?? '',
      description,
      argumentHint: fm.arguments ?? fm['argument-hint'] ?? '',
    }
  } catch {
    return { name: '', description: '', argumentHint: '' }
  }
}

function isDirLike(
  dirPath: string,
  entry: { name: string; isDirectory: () => boolean; isSymbolicLink: () => boolean },
): boolean {
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

/** Claude skill roots (user + project + optional plugins). */
export function getClaudeSkillDirs(cwd: string, opts?: SkillsManageOptions): SkillDir[] {
  const home = homeOf(opts)
  const dirs: SkillDir[] = [
    { dir: join(home, '.claude', 'skills'), scope: 'user' },
    { dir: join(cwd, '.claude', 'skills'), scope: 'project' },
  ]

  const pluginsFile = join(home, '.claude', 'plugins', 'installed_plugins.json')
  if (existsSync(pluginsFile)) {
    try {
      const data = JSON.parse(readFileSync(pluginsFile, 'utf8')) as {
        plugins?: Record<
          string,
          Array<{ scope?: string; installPath?: string; projectPath?: string }>
        >
      }
      const plugins = data.plugins ?? {}
      for (const [pluginKey, entries] of Object.entries(plugins)) {
        const pluginName = pluginKey.split('@')[0] ?? pluginKey
        for (const entry of entries) {
          if (!entry.installPath) continue
          const isProject =
            (entry.scope === 'project' || entry.scope === 'local') && entry.projectPath === cwd
          const isUser = entry.scope === 'user'
          if (!isUser && !isProject) continue
          dirs.push({
            dir: join(entry.installPath, 'skills'),
            scope: isUser ? 'user' : 'project',
            namePrefix: `${pluginName}:`,
            readOnly: true,
          })
        }
      }
    } catch {
      /* ignore corrupt plugins index */
    }
  }

  return dirs
}

/** Codex skill roots (mirrors desktop getCodexSkillDirs). */
export function getCodexSkillDirs(cwd: string, opts?: SkillsManageOptions): SkillDir[] {
  const home = homeOf(opts)
  const cHome = codexHomeOf(opts)
  const dirs: SkillDir[] = [
    { dir: join(home, '.agents', 'skills'), scope: 'user' },
    { dir: join(cHome, 'skills'), scope: 'user' },
    { dir: join(cHome, 'skills', '.system'), scope: 'user', readOnly: true },
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

export function getSkillDirs(
  provider: ResourceProvider,
  cwd: string,
  opts?: SkillsManageOptions,
): SkillDir[] {
  return provider === 'codex' ? getCodexSkillDirs(cwd, opts) : getClaudeSkillDirs(cwd, opts)
}

function walkSkills(
  root: string,
  relPrefix: string,
  depth: number,
  scope: Extract<ResourceScope, 'user' | 'project'>,
  seen: Set<string>,
  skills: SkillInfo[],
  namePrefix?: string,
  readOnly?: boolean,
): void {
  const absDir = relPrefix ? join(root, relPrefix) : root
  let entries: Dirent[]
  try {
    entries = readdirSync(absDir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    if (!isDirLike(absDir, entry)) continue
    const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name
    const skillDir = join(absDir, entry.name)
    if (existsSync(join(skillDir, 'SKILL.md'))) {
      const name = (namePrefix ?? '') + relPath
      const key = resolve(skillDir)
      if (!seen.has(key)) {
        seen.add(key)
        const fm = parseFrontmatterFile(join(skillDir, 'SKILL.md'))
        skills.push({
          name,
          displayName: fm.name || entry.name,
          scope,
          description: fm.description,
          argumentHint: fm.argumentHint || undefined,
          hasConfig: existsSync(join(skillDir, 'config.json')),
          sourcePath: skillDir,
          ...(readOnly ? { builtin: true } : {}),
        })
      }
    }
    if (depth + 1 < MAX_SKILL_SCAN_DEPTH) {
      walkSkills(root, relPath, depth + 1, scope, seen, skills, namePrefix, readOnly)
    }
  }
}

export function listManagedSkills(
  provider: ResourceProvider,
  cwd: string,
  opts?: SkillsManageOptions,
): SkillInfo[] {
  const dirs = getSkillDirs(provider, cwd, opts)
  const skills: SkillInfo[] = []
  const seen = new Set<string>()
  for (const { dir, scope, namePrefix, readOnly } of dirs) {
    if (!existsSync(dir)) continue
    walkSkills(dir, '', 0, scope, seen, skills, namePrefix, readOnly)
  }
  return skills
}

function scanDir(
  dirPath: string,
  depth = 0,
  seen = new Set<string>(),
): SkillFileEntry[] {
  if (depth > MAX_SKILL_SCAN_DEPTH) return []
  let key: string
  try {
    key = resolve(dirPath)
    if (seen.has(key)) return []
    seen.add(key)
  } catch {
    return []
  }
  try {
    return readdirSync(dirPath, { withFileTypes: true })
      .filter((e) => !e.name.startsWith('.'))
      .sort((a, b) => {
        const aDir =
          a.isDirectory() ||
          (a.isSymbolicLink() && statSync(join(dirPath, a.name)).isDirectory())
        const bDir =
          b.isDirectory() ||
          (b.isSymbolicLink() && statSync(join(dirPath, b.name)).isDirectory())
        if (aDir !== bDir) return aDir ? -1 : 1
        return a.name.localeCompare(b.name)
      })
      .map((e) => {
        const isDir =
          e.isDirectory() ||
          (e.isSymbolicLink() && statSync(join(dirPath, e.name)).isDirectory())
        return {
          name: e.name,
          isDirectory: isDir,
          ...(isDir ? { children: scanDir(join(dirPath, e.name), depth + 1, seen) } : {}),
        }
      })
  } catch {
    return []
  }
}

function resolveSkillDir(dir: string, name: string): string | null {
  const root = resolve(dir)
  const candidate = resolve(root, name)
  return candidate === root || candidate.startsWith(root + sep) ? candidate : null
}

export function getManagedSkill(
  provider: ResourceProvider,
  cwd: string,
  name: string,
  sourcePath?: string,
  opts?: SkillsManageOptions,
): SkillDetail | null {
  const dirs = getSkillDirs(provider, cwd, opts)
  for (const { dir, scope, namePrefix } of dirs) {
    const dirName =
      namePrefix && name.startsWith(namePrefix) ? name.slice(namePrefix.length) : name
    const skillDir = resolveSkillDir(dir, dirName)
    if (!skillDir) continue
    if (!isPathAtOrWithinAllowed(skillDir, [dir])) continue
    const skillMd = join(skillDir, 'SKILL.md')
    if (!existsSync(skillMd)) continue
    const expectedName = (namePrefix ?? '') + dirName
    if (expectedName !== name) continue
    if (sourcePath && resolve(skillDir) !== resolve(sourcePath)) continue
    const fm = parseFrontmatterFile(skillMd)
    return {
      name,
      displayName: fm.name || name,
      scope,
      description: fm.description,
      argumentHint: fm.argumentHint || undefined,
      hasConfig: existsSync(join(skillDir, 'config.json')),
      sourcePath: sourcePath ?? skillDir,
      files: scanDir(skillDir),
    }
  }
  return null
}

export function readManagedSkillFile(
  provider: ResourceProvider,
  cwd: string,
  skillName: string,
  relativePath: string,
  sourcePath?: string,
  opts?: SkillsManageOptions,
): string | null {
  if (!relativePath || relativePath.includes('\0')) return null
  if (relativePath.startsWith('/') || relativePath.includes('..')) return null

  const dirs = getSkillDirs(provider, cwd, opts)
  for (const { dir, namePrefix } of dirs) {
    const dirName =
      namePrefix && skillName.startsWith(namePrefix)
        ? skillName.slice(namePrefix.length)
        : skillName
    const skillDir = resolveSkillDir(dir, dirName)
    if (!skillDir) continue
    if (!isPathAtOrWithinAllowed(skillDir, [dir])) continue
    if (!existsSync(join(skillDir, 'SKILL.md'))) continue
    const expectedName = (namePrefix ?? '') + dirName
    if (expectedName !== skillName) continue
    if (sourcePath && resolve(skillDir) !== resolve(sourcePath)) continue

    const resolved = resolve(skillDir, relativePath)
    if (resolved !== skillDir && !resolved.startsWith(skillDir + sep)) return null
    if (!existsSync(resolved) || statSync(resolved).isDirectory()) return null
    if (!isPathAtOrWithinAllowed(resolved, [skillDir])) return null
    try {
      return readFileSync(resolved, 'utf8')
    } catch {
      return null
    }
  }
  return null
}

function assertSkillName(name: string): void {
  if (!name || name.length > 128) {
    throw Object.assign(new Error('invalid skill name'), { code: 'invalid_argument' })
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) {
    throw Object.assign(new Error('skill name must be alphanumeric (._- allowed)'), {
      code: 'invalid_argument',
    })
  }
  if (name.includes('/') || name.includes('\\') || name.includes('..')) {
    throw Object.assign(new Error('skill name must not contain path separators'), {
      code: 'invalid_argument',
    })
  }
}

function assertRelativeSkillFilePath(rel: string): void {
  if (!rel || rel.includes('\0') || rel.startsWith('/') || rel.includes('..')) {
    throw Object.assign(new Error(`invalid skill file path: ${rel}`), {
      code: 'invalid_argument',
    })
  }
  // Normalize separators; reject absolute-looking segments.
  if (rel.split(/[/\\]/).some((s) => s === '' || s === '.' || s === '..')) {
    throw Object.assign(new Error(`invalid skill file path: ${rel}`), {
      code: 'invalid_argument',
    })
  }
}

export function deleteManagedSkill(
  provider: ResourceProvider,
  cwd: string,
  sourcePath: string,
  opts?: SkillsManageOptions,
): void {
  const dirs = getSkillDirs(provider, cwd, opts)
  const target = resolve(sourcePath)
  const writableRoots = dirs.filter((d) => !d.readOnly && !d.namePrefix).map((d) => d.dir)
  const readOnlyRoots = dirs.filter((d) => d.readOnly).map((d) => d.dir)
  const allowed =
    isPathWithinAllowed(target, writableRoots) && !isPathAtOrWithinAllowed(target, readOnlyRoots)
  if (!allowed) {
    throw Object.assign(new Error('skill path is outside a writable root'), {
      code: 'forbidden',
    })
  }
  if (!existsSync(join(target, 'SKILL.md'))) {
    throw Object.assign(new Error('not a skill directory (missing SKILL.md)'), {
      code: 'not_found',
    })
  }
  rmSync(target, { recursive: true, force: true })
}

export function installManagedSkill(
  provider: ResourceProvider,
  cwd: string,
  input: {
    scope: Extract<ResourceScope, 'user' | 'project'>
    name: string
    files: Record<string, string>
  },
  opts?: SkillsManageOptions,
): SkillInfo {
  assertSkillName(input.name)
  const files = input.files ?? {}
  const entries = Object.entries(files)
  if (entries.length === 0) {
    throw Object.assign(new Error('files must not be empty'), { code: 'invalid_argument' })
  }
  if (entries.length > MAX_INSTALL_FILES) {
    throw Object.assign(new Error(`at most ${MAX_INSTALL_FILES} files per install`), {
      code: 'invalid_argument',
    })
  }
  const skillMdKey = Object.keys(files).find((k) => basename(k) === 'SKILL.md' && !k.includes('/'))
  if (!skillMdKey || skillMdKey !== 'SKILL.md') {
    throw Object.assign(new Error('files must include top-level SKILL.md'), {
      code: 'invalid_argument',
    })
  }

  const dirs = getSkillDirs(provider, cwd, opts)
  const root = dirs.find(
    (d) => d.scope === input.scope && !d.readOnly && !d.namePrefix,
  )
  if (!root) {
    throw Object.assign(new Error(`no writable ${input.scope} skill root for ${provider}`), {
      code: 'failed_precondition',
    })
  }

  const dest = join(root.dir, input.name)
  if (existsSync(dest)) {
    throw Object.assign(new Error(`skill already exists: ${input.name}`), {
      code: 'conflict',
    })
  }

  mkdirSync(dest, { recursive: true })
  try {
    for (const [rel, content] of entries) {
      assertRelativeSkillFilePath(rel)
      if (typeof content !== 'string') {
        throw Object.assign(new Error(`file content must be string: ${rel}`), {
          code: 'invalid_argument',
        })
      }
      const bytes = Buffer.byteLength(content, 'utf8')
      if (bytes > MAX_INSTALL_FILE_BYTES) {
        throw Object.assign(new Error(`file exceeds ${MAX_INSTALL_FILE_BYTES} bytes: ${rel}`), {
          code: 'invalid_argument',
        })
      }
      const abs = resolve(dest, rel)
      if (abs !== dest && !abs.startsWith(dest + sep)) {
        throw Object.assign(new Error(`path escapes skill dir: ${rel}`), {
          code: 'invalid_argument',
        })
      }
      mkdirSync(dirname(abs), { recursive: true })
      writeFileSync(abs, content, 'utf8')
    }
  } catch (err) {
    rmSync(dest, { recursive: true, force: true })
    throw err
  }

  const fm = parseFrontmatterFile(join(dest, 'SKILL.md'))
  return {
    name: input.name,
    displayName: fm.name || input.name,
    scope: input.scope,
    description: fm.description,
    argumentHint: fm.argumentHint || undefined,
    hasConfig: existsSync(join(dest, 'config.json')),
    sourcePath: dest,
  }
}
