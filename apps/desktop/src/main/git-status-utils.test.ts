import { describe, it, expect } from 'vitest'
import {
  parseGitStatusLine,
  parseGitStatusOutput,
  parseGitStatusFiles,
  resolveEntryStatusPair,
} from './git-status-utils'

describe('parseGitStatusLine', () => {
  it('parses untracked files (worktree only)', () => {
    expect(parseGitStatusLine('?? src/new.ts')).toEqual({
      path: 'src/new.ts', index: null, worktree: '?', ignored: false, fromPath: null, isDirEntry: false,
    })
  })

  it('parses modified files (unstaged → worktree only)', () => {
    expect(parseGitStatusLine(' M src/app.ts')).toEqual({
      path: 'src/app.ts', index: null, worktree: 'M', ignored: false, fromPath: null, isDirEntry: false,
    })
  })

  it('parses modified files (staged → index only)', () => {
    expect(parseGitStatusLine('M  src/app.ts')).toEqual({
      path: 'src/app.ts', index: 'M', worktree: null, ignored: false, fromPath: null, isDirEntry: false,
    })
  })

  it('parses added files (always staged)', () => {
    expect(parseGitStatusLine('A  src/new.ts')).toEqual({
      path: 'src/new.ts', index: 'A', worktree: null, ignored: false, fromPath: null, isDirEntry: false,
    })
  })

  it('parses deleted files (staged)', () => {
    expect(parseGitStatusLine('D  old.ts')).toEqual({
      path: 'old.ts', index: 'D', worktree: null, ignored: false, fromPath: null, isDirEntry: false,
    })
  })

  it('parses deleted files (unstaged)', () => {
    expect(parseGitStatusLine(' D old.ts')).toEqual({
      path: 'old.ts', index: null, worktree: 'D', ignored: false, fromPath: null, isDirEntry: false,
    })
  })

  it('parses renamed files to the destination path', () => {
    expect(parseGitStatusLine('R  old.ts -> new.ts')).toEqual({
      path: 'new.ts', index: 'R', worktree: null, ignored: false, fromPath: 'old.ts', isDirEntry: false,
    })
  })

  it('parses copied files to the destination path', () => {
    expect(parseGitStatusLine('C  src.ts -> dst.ts')).toEqual({
      path: 'dst.ts', index: 'C', worktree: null, ignored: false, fromPath: 'src.ts', isDirEntry: false,
    })
  })

  it('parses renamed files with quoted paths', () => {
    expect(parseGitStatusLine('R  "old name.ts" -> "new name.ts"')).toEqual({
      path: 'new name.ts', index: 'R', worktree: null, ignored: false, fromPath: 'old name.ts', isDirEntry: false,
    })
  })

  it('parses unmerged files (both columns U)', () => {
    expect(parseGitStatusLine('UU conflict.ts')).toEqual({
      path: 'conflict.ts', index: 'U', worktree: 'U', ignored: false, fromPath: null, isDirEntry: false,
    })
  })

  it('parses ignored directories', () => {
    expect(parseGitStatusLine('!! node_modules/')).toEqual({
      path: 'node_modules', index: null, worktree: '!', ignored: true, fromPath: null, isDirEntry: true,
    })
  })

  it('parses ignored files without trailing slash', () => {
    expect(parseGitStatusLine('!! .env')).toEqual({
      path: '.env', index: null, worktree: '!', ignored: true, fromPath: null, isDirEntry: false,
    })
  })

  it('parses partial-stage modifications (staged + later worktree change)', () => {
    expect(parseGitStatusLine('MM src/app.ts')).toEqual({
      path: 'src/app.ts', index: 'M', worktree: 'M', ignored: false, fromPath: null, isDirEntry: false,
    })
  })

  it('parses staged add with subsequent worktree edit', () => {
    expect(parseGitStatusLine('AM src/new.ts')).toEqual({
      path: 'src/new.ts', index: 'A', worktree: 'M', ignored: false, fromPath: null, isDirEntry: false,
    })
  })

  it('strips trailing slash from untracked directories', () => {
    expect(parseGitStatusLine('?? newdir/')).toEqual({
      path: 'newdir', index: null, worktree: '?', ignored: false, fromPath: null, isDirEntry: true,
    })
  })

  it('unquotes paths with spaces', () => {
    expect(parseGitStatusLine('?? "my folder/file.ts"')).toEqual({
      path: 'my folder/file.ts', index: null, worktree: '?', ignored: false, fromPath: null, isDirEntry: false,
    })
  })

  it('unquotes untracked directories with spaces', () => {
    expect(parseGitStatusLine('?? "my folder/"')).toEqual({
      path: 'my folder', index: null, worktree: '?', ignored: false, fromPath: null, isDirEntry: true,
    })
  })

  it('parses typechange (worktree T)', () => {
    expect(parseGitStatusLine(' T a.ts')).toEqual({
      path: 'a.ts', index: null, worktree: 'T', ignored: false, fromPath: null, isDirEntry: false,
    })
  })

  it('parses typechange (staged T)', () => {
    expect(parseGitStatusLine('T  a.ts')).toEqual({
      path: 'a.ts', index: 'T', worktree: null, ignored: false, fromPath: null, isDirEntry: false,
    })
  })
})

describe('parseGitStatusOutput', () => {
  it('returns empty maps for empty input', () => {
    const result = parseGitStatusOutput('')
    expect(result.statusMap.size).toBe(0)
    expect(result.ignoredDirs.size).toBe(0)
    expect(result.untrackedDirs.size).toBe(0)
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

  it('tracks untracked directories (git reports ?? dir/ only)', () => {
    const raw = '?? newdir/\n?? lone.ts'
    const { statusMap, untrackedDirs } = parseGitStatusOutput(raw)
    expect(untrackedDirs.has('newdir')).toBe(true)
    expect(untrackedDirs.has('lone.ts')).toBe(false)
    expect(statusMap.get('newdir')).toEqual({ index: null, worktree: '?' })
    expect(statusMap.has('newdir/')).toBe(false)
  })

  it('maps rename to the destination path in statusMap', () => {
    const { statusMap } = parseGitStatusOutput('R  old.ts -> new.ts')
    expect(statusMap.get('new.ts')).toEqual({ index: 'R', worktree: null })
    expect(statusMap.has('old.ts -> new.ts')).toBe(false)
  })

  it('unquotes spaced paths in statusMap and untrackedDirs', () => {
    const { statusMap, untrackedDirs } = parseGitStatusOutput('?? "my folder/"')
    expect(untrackedDirs.has('my folder')).toBe(true)
    expect(statusMap.get('my folder')).toEqual({ index: null, worktree: '?' })
  })

  it('maps typechange into statusMap', () => {
    const { statusMap } = parseGitStatusOutput(' T a.ts')
    expect(statusMap.get('a.ts')).toEqual({ index: null, worktree: 'T' })
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

  it('uses rename destination path for source-control list', () => {
    expect(parseGitStatusFiles('R  old.ts -> new.ts')).toEqual([
      { path: 'new.ts', status: 'R', staged: true },
    ])
  })

  it('surfaces typechange as T', () => {
    expect(parseGitStatusFiles(' T a.ts')).toEqual([
      { path: 'a.ts', status: 'T', staged: false },
    ])
  })
})

describe('resolveEntryStatusPair — file tree coloring', () => {
  it('colors files under an untracked dir as untracked (git only reports ?? dir/)', () => {
    const parsed = parseGitStatusOutput('?? newdir/')
    expect(resolveEntryStatusPair('newdir', true, parsed)).toEqual({ index: null, worktree: '?' })
    expect(resolveEntryStatusPair('newdir/a.ts', false, parsed)).toEqual({ index: null, worktree: '?' })
    expect(resolveEntryStatusPair('newdir/sub', true, parsed)).toEqual({ index: null, worktree: '?' })
    expect(resolveEntryStatusPair('newdir/sub/b.ts', false, parsed)).toEqual({ index: null, worktree: '?' })
  })

  it('colors descendants of ignored dirs as ignored (git only reports !! dir/)', () => {
    const parsed = parseGitStatusOutput('!! node_modules/')
    expect(resolveEntryStatusPair('node_modules', true, parsed)).toEqual({ index: null, worktree: '!' })
    expect(resolveEntryStatusPair('node_modules/pkg', true, parsed)).toEqual({ index: null, worktree: '!' })
    expect(resolveEntryStatusPair('node_modules/pkg/index.js', false, parsed)).toEqual({ index: null, worktree: '!' })
  })

  it('does not treat siblings outside untracked/ignored dirs as dirty', () => {
    const parsed = parseGitStatusOutput('?? newdir/\n!! node_modules/')
    expect(resolveEntryStatusPair('src', true, parsed)).toEqual({ index: null, worktree: null })
    expect(resolveEntryStatusPair('src/app.ts', false, parsed)).toEqual({ index: null, worktree: null })
  })

  it('keeps exact file status for tracked dirty files', () => {
    const parsed = parseGitStatusOutput(' M src/app.ts\nM  src/staged.ts')
    expect(resolveEntryStatusPair('src/app.ts', false, parsed)).toEqual({ index: null, worktree: 'M' })
    expect(resolveEntryStatusPair('src/staged.ts', false, parsed)).toEqual({ index: 'M', worktree: null })
  })

  it('aggregates child status onto parent dirs (higher priority wins)', () => {
    // M (3) outranks ? (1) — mixed dir shows modified, not untracked
    const parsed = parseGitStatusOutput(' M src/nested/app.ts\n?? src/nested/new.ts')
    expect(resolveEntryStatusPair('src', true, parsed)).toEqual({ index: null, worktree: 'M' })
    expect(resolveEntryStatusPair('src/nested', true, parsed)).toEqual({ index: null, worktree: 'M' })
  })

  it('aggregates pure-untracked children as untracked on parent dirs', () => {
    const parsed = parseGitStatusOutput('?? src/nested/new.ts\n?? src/other.ts')
    expect(resolveEntryStatusPair('src', true, parsed)).toEqual({ index: null, worktree: '?' })
    expect(resolveEntryStatusPair('src/nested', true, parsed)).toEqual({ index: null, worktree: '?' })
  })

  it('prefers higher-priority child statuses when aggregating dirs', () => {
    const parsed = parseGitStatusOutput(' M src/a.ts\n D src/b.ts')
    // D (5) > M (3)
    expect(resolveEntryStatusPair('src', true, parsed)).toEqual({ index: null, worktree: 'D' })
  })

  it('colors renamed destination files', () => {
    const parsed = parseGitStatusOutput('R  old.ts -> new.ts')
    expect(resolveEntryStatusPair('new.ts', false, parsed)).toEqual({ index: 'R', worktree: null })
  })

  it('colors quoted untracked dir descendants', () => {
    const parsed = parseGitStatusOutput('?? "my folder/"')
    expect(resolveEntryStatusPair('my folder', true, parsed)).toEqual({ index: null, worktree: '?' })
    expect(resolveEntryStatusPair('my folder/a.ts', false, parsed)).toEqual({ index: null, worktree: '?' })
  })

  it('colors typechange files', () => {
    const parsed = parseGitStatusOutput(' T a.ts')
    expect(resolveEntryStatusPair('a.ts', false, parsed)).toEqual({ index: null, worktree: 'T' })
  })

  it('ignored wins over untracked when both could apply', () => {
    // A path under an ignored dir must stay ignored even if somehow also marked untracked.
    const parsed = parseGitStatusOutput('!! build/\n?? build/leak.ts')
    // ignored ancestor takes precedence for descendants
    expect(resolveEntryStatusPair('build/leak.ts', false, parsed).worktree).toBe('!')
  })
})
