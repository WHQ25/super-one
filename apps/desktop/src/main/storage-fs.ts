import { lstatSync, readdirSync, rmSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import { join } from 'node:path'

export function directoryBytes(root: string): number {
  let stat
  try {
    stat = lstatSync(root)
  } catch {
    return 0
  }
  if (stat.isSymbolicLink()) return 0
  if (!stat.isDirectory()) return stat.size
  let entries: Dirent[]
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return 0
  }
  let total = 0
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue
    const child = join(root, entry.name)
    total += entry.isDirectory() ? directoryBytes(child) : fileBytes(child)
  }
  return total
}

export function entryBytes(path: string): number {
  return isDirectory(path) ? directoryBytes(path) : fileBytes(path)
}

export function fileBytes(path: string): number {
  try {
    const stat = lstatSync(path)
    return stat.isSymbolicLink() || stat.isDirectory() ? 0 : stat.size
  } catch {
    return 0
  }
}

export function namedChildren(dir: string): string[] {
  if (!isDirectory(dir)) return []
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

export function exists(path: string): boolean {
  try {
    return !lstatSync(path).isSymbolicLink()
  } catch {
    return false
  }
}

export function isDirectory(path: string): boolean {
  try {
    const stat = lstatSync(path)
    return stat.isDirectory() && !stat.isSymbolicLink()
  } catch {
    return false
  }
}

export function mtimeMs(path: string): number {
  try {
    const stat = lstatSync(path)
    return stat.isSymbolicLink() ? 0 : stat.mtimeMs
  } catch {
    return 0
  }
}

export function removeTree(path: string): void {
  let stat
  try {
    stat = lstatSync(path)
  } catch {
    return
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    try {
      rmSync(path, { force: true })
    } catch {
      return
    }
    return
  }
  try {
    rmSync(path, { recursive: true, force: true })
  } catch {
    for (const name of namedChildren(path)) removeTree(join(path, name))
  }
}
