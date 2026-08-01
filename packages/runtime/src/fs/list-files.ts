import { existsSync, readdirSync, statSync, type Dirent } from 'node:fs'
import { join } from 'node:path'
import { resolveProjectPath } from './path-security'

/** Same baseline excludes as desktop fuzzy-file-search (no .gitignore). */
export const LIST_FILES_EXCLUDED = new Set([
  '.git',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  '.venv',
  '.gradle',
  '.cargo',
  '.tox',
  '.mypy_cache',
  'node_modules',
  'dist',
  'build',
  '__pycache__',
])

export const MAX_LIST_FILES = 20_000
export const DEFAULT_LIST_DEPTH = 10

export interface WorkspaceFileEntry {
  path: string
  isDirectory: boolean
}

/**
 * Inventory relative paths under a project root (for @-mention / file search).
 * Pure FS walk — no ProjectRegistry.
 */
export function listFilesUnderRoot(
  projectRoot: string,
  opts?: { relativePath?: string; maxDepth?: number; maxFiles?: number },
): WorkspaceFileEntry[] {
  const startRel = opts?.relativePath?.trim() || '.'
  const resolved = resolveProjectPath(projectRoot, startRel)
  if (!resolved.ok) {
    throw Object.assign(new Error(resolved.reason), { code: 'invalid_argument' })
  }
  if (!existsSync(resolved.absolutePath)) {
    throw Object.assign(new Error('path not found'), { code: 'not_found' })
  }
  const st = statSync(resolved.absolutePath)
  if (!st.isDirectory()) {
    throw Object.assign(new Error('not a directory'), { code: 'invalid_argument' })
  }
  const maxDepth = Math.min(Math.max(opts?.maxDepth ?? DEFAULT_LIST_DEPTH, 1), 20)
  const maxFiles = Math.min(Math.max(opts?.maxFiles ?? MAX_LIST_FILES, 1), MAX_LIST_FILES)
  const out: WorkspaceFileEntry[] = []
  const baseRel =
    startRel === '.' || startRel === ''
      ? ''
      : startRel.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '')

  const walk = (absDir: string, relPrefix: string, depth: number) => {
    if (out.length >= maxFiles || depth > maxDepth) return
    let ents: Dirent[]
    try {
      ents = readdirSync(absDir, { withFileTypes: true })
    } catch {
      return
    }
    for (const ent of ents) {
      if (out.length >= maxFiles) return
      if (LIST_FILES_EXCLUDED.has(ent.name) || ent.name === '.DS_Store') continue
      const abs = join(absDir, ent.name)
      const rel = relPrefix ? `${relPrefix}/${ent.name}` : ent.name
      const check = resolveProjectPath(projectRoot, rel)
      if (!check.ok) continue
      let isDirectory = ent.isDirectory()
      if (ent.isSymbolicLink()) {
        try {
          isDirectory = statSync(abs).isDirectory()
        } catch {
          continue
        }
      }
      out.push({ path: rel, isDirectory })
      if (isDirectory) walk(abs, rel, depth + 1)
    }
  }

  walk(resolved.absolutePath, baseRel, 0)
  return out
}
