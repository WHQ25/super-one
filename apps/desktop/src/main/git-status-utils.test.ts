import { describe, it, expect } from 'vitest'
import { parseGitStatusLine, parseGitStatusOutput, parseGitStatusFiles } from './git-status-utils'

describe('parseGitStatusLine', () => {
  it('should parse untracked files', () => {
    expect(parseGitStatusLine('?? src/new.ts')).toEqual({
      path: 'src/new.ts', status: '?', ignored: false,
    })
  })

  it('should parse modified files (unstaged)', () => {
    expect(parseGitStatusLine(' M src/app.ts')).toEqual({
      path: 'src/app.ts', status: 'M', ignored: false,
    })
  })

  it('should parse modified files (staged)', () => {
    expect(parseGitStatusLine('M  src/app.ts')).toEqual({
      path: 'src/app.ts', status: 'M', ignored: false,
    })
  })

  it('should parse added files', () => {
    expect(parseGitStatusLine('A  src/new.ts')).toEqual({
      path: 'src/new.ts', status: 'A', ignored: false,
    })
  })

  it('should parse deleted files (staged)', () => {
    expect(parseGitStatusLine('D  old.ts')).toEqual({
      path: 'old.ts', status: 'D', ignored: false,
    })
  })

  it('should parse deleted files (unstaged)', () => {
    expect(parseGitStatusLine(' D old.ts')).toEqual({
      path: 'old.ts', status: 'D', ignored: false,
    })
  })

  it('should parse renamed files', () => {
    expect(parseGitStatusLine('R  old.ts -> new.ts')).toEqual({
      path: 'old.ts -> new.ts', status: 'R', ignored: false,
    })
  })

  it('should parse copied files', () => {
    expect(parseGitStatusLine('C  src.ts -> dst.ts')).toEqual({
      path: 'src.ts -> dst.ts', status: 'C', ignored: false,
    })
  })

  it('should parse unmerged files', () => {
    expect(parseGitStatusLine('UU conflict.ts')).toEqual({
      path: 'conflict.ts', status: 'U', ignored: false,
    })
  })

  it('should parse ignored files', () => {
    expect(parseGitStatusLine('!! node_modules/')).toEqual({
      path: 'node_modules', status: '!', ignored: true,
    })
  })

  it('should parse ignored files without trailing slash', () => {
    expect(parseGitStatusLine('!! .env')).toEqual({
      path: '.env', status: '!', ignored: true,
    })
  })

  it('should handle both staged and unstaged modifications', () => {
    expect(parseGitStatusLine('MM src/app.ts')).toEqual({
      path: 'src/app.ts', status: 'M', ignored: false,
    })
  })
})

describe('parseGitStatusOutput', () => {
  it('should parse empty output', () => {
    const result = parseGitStatusOutput('')
    expect(result.statusMap.size).toBe(0)
    expect(result.ignoredDirs.size).toBe(0)
  })

  it('should parse multiple status lines', () => {
    const raw = [
      'M  src/app.ts',
      '?? src/new.ts',
      ' D removed.ts',
    ].join('\n')
    const result = parseGitStatusOutput(raw)
    expect(result.statusMap.get('src/app.ts')).toBe('M')
    expect(result.statusMap.get('src/new.ts')).toBe('?')
    expect(result.statusMap.get('removed.ts')).toBe('D')
  })

  it('should track ignored directories', () => {
    const raw = [
      '!! node_modules/',
      '!! dist/',
      '!! .env',
    ].join('\n')
    const result = parseGitStatusOutput(raw)
    expect(result.ignoredDirs.has('node_modules')).toBe(true)
    expect(result.ignoredDirs.has('dist')).toBe(true)
    expect(result.ignoredDirs.has('.env')).toBe(false)
  })
})

describe('parseGitStatusOutput with trimEnd (gitRun regression)', () => {
  it('should preserve leading space on first line after trimEnd', () => {
    const raw = ' M src/main/file-watcher.ts\n?? .claude/\n!! .env'
    const trimmed = raw.trimEnd()
    const result = parseGitStatusOutput(trimmed)
    expect(result.statusMap.get('src/main/file-watcher.ts')).toBe('M')
    expect(result.statusMap.get('rc/main/file-watcher.ts')).toBeUndefined()
  })

  it('should fail with trim (documents the bug)', () => {
    const raw = ' M src/main/file-watcher.ts\n?? .claude/'
    const trimmed = raw.trim()
    const result = parseGitStatusOutput(trimmed)
    expect(result.statusMap.has('src/main/file-watcher.ts')).toBe(false)
  })
})

describe('parseGitStatusFiles', () => {
  it('should return empty array for empty input', () => {
    expect(parseGitStatusFiles('')).toEqual([])
  })

  it('should correctly detect staged vs unstaged', () => {
    const raw = [
      'M  staged.ts',
      ' M unstaged.ts',
      '?? untracked.ts',
    ].join('\n')
    const files = parseGitStatusFiles(raw)
    expect(files).toEqual([
      { path: 'staged.ts', status: 'M', staged: true },
      { path: 'unstaged.ts', status: 'M', staged: false },
      { path: 'untracked.ts', status: '?', staged: false },
    ])
  })

  it('should mark added files as staged', () => {
    const files = parseGitStatusFiles('A  new.ts')
    expect(files[0].staged).toBe(true)
  })
})
