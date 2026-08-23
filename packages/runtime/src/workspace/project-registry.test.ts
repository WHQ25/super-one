import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openNodeDatabase, type NodeDatabase } from '../db/database'
import { ProjectRegistry } from './project-registry'

let db: NodeDatabase
let registry: ProjectRegistry
let root: string
let sibling: string

beforeEach(() => {
  db = openNodeDatabase(':memory:')
  registry = new ProjectRegistry(db)
  const base = mkdtempSync(join(tmpdir(), 'project-registry-'))
  root = join(base, 'repo')
  sibling = join(base, 'shared-lib')
  mkdirSync(root, { recursive: true })
  mkdirSync(sibling, { recursive: true })
})

afterEach(() => db.close())

describe('project name across re-opens', () => {
  it('keeps a custom name when the same path is opened again', () => {
    const opened = registry.open(root)
    registry.update({ projectId: opened.projectId, name: 'Renamed Project' })

    // The desktop calls project.open on every selection.
    registry.open(root)

    expect(registry.get(opened.projectId)?.name).toBe('Renamed Project')
  })

  it('rejects an empty name rather than leaving the sidebar row blank', () => {
    const opened = registry.open(root)
    expect(() => registry.update({ projectId: opened.projectId, name: '  ' })).toThrow(/empty/)
  })

  it('reports no project for an id that was never registered', () => {
    expect(registry.update({ projectId: 'nope', name: 'x' })).toBeNull()
  })
})

describe('project workspace folders on a node', () => {
  it('defaults to an empty list for a freshly opened project', () => {
    expect(registry.open(root).extraDirs).toEqual([])
  })

  it('round-trips a folder list through list, get and getByPath', () => {
    const opened = registry.open(root)
    registry.update({ projectId: opened.projectId, extraDirs: [sibling] })

    expect(registry.get(opened.projectId)?.extraDirs).toEqual([sibling])
    // `open()` stores the realpath, so look up by what it actually recorded.
    expect(registry.getByPath(opened.path)?.extraDirs).toEqual([sibling])
    expect(registry.list()[0].extraDirs).toEqual([sibling])
  })

  it('normalizes the list the same way the desktop catalog does', () => {
    const opened = registry.open(root)
    registry.update({
      projectId: opened.projectId,
      // duplicate, blank, trailing separator, and the project root itself
      extraDirs: [sibling, `${sibling}/`, '  ', opened.path],
    })

    expect(registry.get(opened.projectId)?.extraDirs).toEqual([sibling])
  })

  it('leaves folders untouched when only the name is edited', () => {
    const opened = registry.open(root)
    registry.update({ projectId: opened.projectId, extraDirs: [sibling] })

    registry.update({ projectId: opened.projectId, name: 'Renamed' })

    const after = registry.get(opened.projectId)
    expect(after?.name).toBe('Renamed')
    expect(after?.extraDirs).toEqual([sibling])
  })

  it('resolves the project by the path the user typed, not just the stored realpath', () => {
    // `root` lives under /var on macOS, which is a symlink to /private/var —
    // `open()` canonicalizes it away, so a naive path lookup would 404.
    registry.open(root)
    const updated = registry.update({ path: root, extraDirs: [sibling] })
    expect(updated?.extraDirs).toEqual([sibling])
  })
})

describe('upgrading a node database written before workspace folders existed', () => {
  it('adds the column and reads an empty list for pre-existing rows', () => {
    const legacy = openNodeDatabase(':memory:')
    try {
      // Simulate the pre-feature shape: drop and recreate without the column.
      legacy.exec('DROP TABLE projects')
      legacy.exec(`CREATE TABLE projects (
        project_id TEXT PRIMARY KEY NOT NULL,
        path TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        repo_identity TEXT,
        opened_at INTEGER,
        last_active_at INTEGER
      )`)
      legacy
        .prepare('INSERT INTO projects (project_id, path, name) VALUES (?, ?, ?)')
        .run('legacy', root, 'repo')

      const cols = legacy.prepare('PRAGMA table_info(projects)').all() as Array<{ name: string }>
      expect(cols.some((c) => c.name === 'extra_dirs_json')).toBe(false)

      legacy.exec(`ALTER TABLE projects ADD COLUMN extra_dirs_json TEXT NOT NULL DEFAULT '[]'`)

      expect(new ProjectRegistry(legacy).get('legacy')?.extraDirs).toEqual([])
    } finally {
      legacy.close()
    }
  })
})
