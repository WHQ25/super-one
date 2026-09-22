import { describe, expect, it } from 'vitest'
import type { BashEditDiff } from './agent-types'
import {
  bashEditFileChanges,
  bashEditToolUses,
  hunksToContent,
  hunksToUnifiedDiff,
  parseBashEditDiff,
  summarizeBashEditDiff,
} from './bash-edit-diff'

// Shape the CLI emitted for `printf "world\n" >> a.txt && printf "new\n" > b.txt` (SDK 0.3.269).
const CLI_RESULT = {
  files: [
    { filePath: '/repo/a.txt', hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, lines: [' hello', '+world'] }] },
    { filePath: '/repo/b.txt', hunks: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 1, lines: ['+new'] }], created: true },
  ],
  moreFiles: 0,
  changedFiles: ['/repo/a.txt', '/repo/b.txt'],
}

describe('parseBashEditDiff', () => {
  it('accepts the CLI shape and drops malformed entries', () => {
    const parsed = parseBashEditDiff({
      ...CLI_RESULT,
      files: [...CLI_RESULT.files, { hunks: [] }, 'nope'],
      changedFiles: ['/repo/a.txt', 7],
    })
    expect(parsed).toEqual({
      files: [
        { filePath: '/repo/a.txt', hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, lines: [' hello', '+world'] }] },
        { filePath: '/repo/b.txt', hunks: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 1, lines: ['+new'] }], created: true },
      ],
      moreFiles: 0,
      changedFiles: ['/repo/a.txt'],
    })
  })

  it('returns undefined for a missing, foreign, or empty diff', () => {
    expect(parseBashEditDiff(undefined)).toBeUndefined()
    expect(parseBashEditDiff({ stdout: '' })).toBeUndefined()
    expect(parseBashEditDiff({ files: [], moreFiles: 0 })).toBeUndefined()
  })

  it('keeps a deliberate skip so the row can say why there is no diff', () => {
    expect(parseBashEditDiff({ files: [], moreFiles: 0, skipped: true })).toEqual({ files: [], moreFiles: 0, skipped: true })
  })
})

describe('bashEditToolUses', () => {
  it('maps modified / created / deleted files onto Edit / Write / Delete rows', () => {
    const diff: BashEditDiff = {
      files: [
        ...CLI_RESULT.files,
        { filePath: '/repo/gone.txt', hunks: [{ oldStart: 1, oldLines: 2, newStart: 0, newLines: 0, lines: ['-one', '-two'] }], deleted: true },
      ],
      moreFiles: 0,
    }
    const rows = bashEditToolUses('bash-1', diff)
    expect(rows.map((row) => [row.toolName, row.toolUseId, row.added, row.removed, row.pathOnly])).toEqual([
      ['Edit', 'bash-1#edit0', 1, 0, false],
      ['Write', 'bash-1#edit1', 1, 0, false],
      ['Delete', 'bash-1#edit2', 0, 2, false],
    ])
    expect(JSON.parse(rows[0].input)).toEqual({ file_path: '/repo/a.txt', diff: '@@ -1,1 +1,2 @@\n hello\n+world' })
    expect(JSON.parse(rows[1].input)).toEqual({ file_path: '/repo/b.txt', content: 'new\n' })
    expect(JSON.parse(rows[2].input)).toEqual({ file_path: '/repo/gone.txt', diff: '@@ -1,2 +0,0 @@\n-one\n-two' })
  })

  it('adds header-only rows for changed files the CLI listed without hunks', () => {
    const diff: BashEditDiff = {
      files: [{ filePath: '/repo/big.bin', hunks: [] }],
      moreFiles: 1,
      changedFiles: ['/repo/big.bin', '/repo/other.ts'],
      unavailable: true,
    }
    const rows = bashEditToolUses('bash-1', diff)
    expect(rows.map((row) => [row.toolName, row.filePath, row.pathOnly])).toEqual([
      ['Edit', '/repo/big.bin', true],
      ['Edit', '/repo/other.ts', true],
    ])
    expect(JSON.parse(rows[1].input)).toEqual({ file_path: '/repo/other.ts' })
  })
})

describe('summarizeBashEditDiff', () => {
  it('totals the rows the diff renders', () => {
    expect(summarizeBashEditDiff({ ...CLI_RESULT })).toEqual({ files: 2, added: 2, removed: 0, approximate: false })
  })

  it('counts hidden files past the rows and marks the totals approximate', () => {
    expect(summarizeBashEditDiff({
      files: [CLI_RESULT.files[0]],
      moreFiles: 3,
      changedFiles: ['/repo/a.txt', '/repo/x.ts'],
    })).toEqual({ files: 4, added: 1, removed: 0, approximate: true })
  })
})

describe('bashEditFileChanges', () => {
  it('yields the path + delta rows the turn stat folds in', () => {
    expect(bashEditFileChanges({ ...CLI_RESULT })).toEqual([
      { path: '/repo/a.txt', added: 1, removed: 0 },
      { path: '/repo/b.txt', added: 1, removed: 0 },
    ])
  })
})

describe('hunk rendering', () => {
  it('writes unified hunk headers the Edit row parser reads back', () => {
    expect(hunksToUnifiedDiff([
      { oldStart: 3, oldLines: 2, newStart: 3, newLines: 1, lines: [' keep', '-drop'] },
      { oldStart: 9, oldLines: 0, newStart: 8, newLines: 1, lines: ['+tail'] },
    ])).toBe('@@ -3,2 +3,1 @@\n keep\n-drop\n@@ -9,0 +8,1 @@\n+tail')
  })

  it('rebuilds a created file from its + rows', () => {
    expect(hunksToContent([{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 2, lines: ['+a', '+b'] }])).toBe('a\nb\n')
    expect(hunksToContent([])).toBe('')
  })
})
