import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { projectIgnoreFilter } from './remote-directory-ignores'

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'ignores-'))
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, content)
  }
  return root
}

describe('projectIgnoreFilter', () => {
  it('filters nothing in a project that has no rules', () => {
    expect(projectIgnoreFilter(project({ 'src/app.ts': '' }))).toBeNull()
  })

  it('hides the files the project itself ignores', () => {
    const root = project({ '.gitignore': 'dist\n*.log\n', 'src/app.ts': '' })
    const ignored = projectIgnoreFilter(root)
    expect(ignored?.('dist', true)).toBe(true)
    expect(ignored?.('debug.log', false)).toBe(true)
    expect(ignored?.('src', true)).toBe(false)
  })

  it('applies rules written above the directory being listed', () => {
    // A monorepo keeps its rules at the root, not in every package.
    const root = project({ '.gitignore': 'build/\n', 'packages/ui/keep.ts': '' })
    const ignored = projectIgnoreFilter(join(root, 'packages/ui'))
    expect(ignored?.('build', true)).toBe(true)
    expect(ignored?.('keep.ts', false)).toBe(false)
  })

  it('stops at the repository root instead of reaching into the home directory', () => {
    // Walking to the filesystem root would import whatever `.gitignore` the user
    // keeps in `~`, and hide files the project itself tracks.
    const outer = project({ '.gitignore': 'src\n', 'repo/.git/HEAD': '', 'repo/src/app.ts': '' })
    expect(projectIgnoreFilter(join(outer, 'repo'))).toBeNull()
  })

  it('honours a directory-only rule only for directories', () => {
    const root = project({ '.gitignore': 'cache/\n' })
    const ignored = projectIgnoreFilter(root)
    expect(ignored?.('cache', true)).toBe(true)
    expect(ignored?.('cache', false)).toBe(false)
  })
})
