import { describe, it, expect } from 'vitest'
import { parseGitStatusLine, parseGitStatusOutput, parseGitStatusFiles } from './git-status-utils'

describe('parseGitStatusLine', () => {
  it('parses untracked files (worktree only)', () => {
    expect(parseGitStatusLine('?? src/new.ts')).toEqual({
      path: 'src/new.ts', index: null, worktree: '?', ignored: false,
    })
  })

  it('parses modified files (unstaged → worktree only)', () => {
    expect(parseGitStatusLine(' M src/app.ts')).toEqual({
      path: 'src/app.ts', index: null, worktree: 'M', ignored: false,
    })
  })

  it('parses modified files (staged → index only)', () => {
    expect(parseGitStatusLine('M  src/app.ts')).toEqual({
      path: 'src/app.ts', index: 'M', worktree: null, ignored: false,
    })
  })

  it('parses added files (always staged)', () => {
    expect(parseGitStatusLine('A  src/new.ts')).toEqual({
      path: 'src/new.ts', index: 'A', worktree: null, ignored: false,
    })
  })

  it('parses deleted files (staged)', () => {
    expect(parseGitStatusLine('D  old.ts')).toEqual({
      path: 'old.ts', index: 'D', worktree: null, ignored: false,
    })
  })

  it('parses deleted files (unstaged)', () => {
    expect(parseGitStatusLine(' D old.ts')).toEqual({
      path: 'old.ts', index: null, worktree: 'D', ignored: false,
    })
  })

  it('parses renamed files (staged)', () => {
    expect(parseGitStatusLine('R  old.ts -> new.ts')).toEqual({
      path: 'old.ts -> new.ts', index: 'R', worktree: null, ignored: false,
    })
  })

  it('parses copied files (staged)', () => {
    expect(parseGitStatusLine('C  src.ts -> dst.ts')).toEqual({
      path: 'src.ts -> dst.ts', index: 'C', worktree: null, ignored: false,
    })
  })

  it('parses unmerged files (both columns U)', () => {
    expect(parseGitStatusLine('UU conflict.ts')).toEqual({
      path: 'conflict.ts', index: 'U', worktree: 'U', ignored: false,
    })
  })

  it('parses ignored directories', () => {
    expect(parseGitStatusLine('!! node_modules/')).toEqual({
      path: 'node_modules', index: null, worktree: '!', ignored: true,
    })
  })

  it('parses ignored files without trailing slash', () => {
    expect(parseGitStatusLine('!! .env')).toEqual({
      path: '.env', index: null, worktree: '!', ignored: true,
    })
  })

  it('parses partial-stage modifications (staged + later worktree change)', () => {
    expect(parseGitStatusLine('MM src/app.ts')).toEqual({
      path: 'src/app.ts', index: 'M', worktree: 'M', ignored: false,
    })
  })

  it('parses staged add with subsequent worktree edit', () => {
    expect(parseGitStatusLine('AM src/new.ts')).toEqual({
      path: 'src/new.ts', index: 'A', worktree: 'M', ignored: false,
    })
  })
})

describe('parseGitStatusOutput', () => {
  it('returns empty maps for empty input', () => {
    const result = parseGitStatusOutput('')
    expect(result.statusMap.size).toBe(0)
    expect(result.ignoredDirs.size).toBe(0)
  })

  it('exposes index and worktree per path', () => {
    const raw = [
      'M  staged-mod.ts',
      ' M unstaged-mod.ts',
      '?? untracked.ts',
      ' D worktree-del.ts',
      'MM partial.ts',
    ].join('\n')
    const { statusMap } = parseGitStatusOutput(raw)
    expect(statusMap.get('staged-mod.ts')).toEqual({ index: 'M', worktree: null })
    expect(statusMap.get('unstaged-mod.ts')).toEqual({ index: null, worktree: 'M' })
    expect(statusMap.get('untracked.ts')).toEqual({ index: null, worktree: '?' })
    expect(statusMap.get('worktree-del.ts')).toEqual({ index: null, worktree: 'D' })
    expect(statusMap.get('partial.ts')).toEqual({ index: 'M', worktree: 'M' })
  })

  it('tracks ignored directories', () => {
    const raw = [
      '!! node_modules/',
      '!! dist/',
      '!! .env',
    ].join('\n')
    const { ignoredDirs } = parseGitStatusOutput(raw)
    expect(ignoredDirs.has('node_modules')).toBe(true)
    expect(ignoredDirs.has('dist')).toBe(true)
    expect(ignoredDirs.has('.env')).toBe(false)
  })
})

describe('parseGitStatusOutput with trimEnd (gitRun regression)', () => {
  it('preserves leading space on first line after trimEnd', () => {
    const raw = ' M src/main/file-watcher.ts\n?? .claude/\n!! .env'
    const trimmed = raw.trimEnd()
    const { statusMap } = parseGitStatusOutput(trimmed)
    expect(statusMap.get('src/main/file-watcher.ts')).toEqual({ index: null, worktree: 'M' })
    expect(statusMap.has('rc/main/file-watcher.ts')).toBe(false)
  })

  it('documents the bug when trim is used instead of trimEnd', () => {
    const raw = ' M src/main/file-watcher.ts\n?? .claude/'
    const trimmed = raw.trim()
    const { statusMap } = parseGitStatusOutput(trimmed)
    expect(statusMap.has('src/main/file-watcher.ts')).toBe(false)
  })
})

describe('parseGitStatusFiles', () => {
  it('returns empty array for empty input', () => {
    expect(parseGitStatusFiles('')).toEqual([])
  })

  it('preserves the legacy {status, staged} shape for source-control consumers', () => {
    const raw = [
      'M  staged.ts',
      ' M unstaged.ts',
      '?? untracked.ts',
    ].join('\n')
    expect(parseGitStatusFiles(raw)).toEqual([
      { path: 'staged.ts', status: 'M', staged: true },
      { path: 'unstaged.ts', status: 'M', staged: false },
      { path: 'untracked.ts', status: '?', staged: false },
    ])
  })

  it('marks added files as staged', () => {
    expect(parseGitStatusFiles('A  new.ts')[0].staged).toBe(true)
  })

  it('treats partial-stage as staged in legacy shape', () => {
    expect(parseGitStatusFiles('MM both.ts')).toEqual([
      { path: 'both.ts', status: 'M', staged: true },
    ])
  })
})
