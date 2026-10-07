import { describe, expect, it } from 'vitest'
import { parsePatchToolText, patchFileToolUse, patchToolFiles, patchToolLineDelta, summarizePatchToolFiles } from './patch-tool'

const patch = '*** Begin Patch\n*** Update File: src/a.ts\n@@ export const enabled\n-const enabled = false\n+const enabled = true\n context\n*** Update File: src/old.ts\n*** Move to: src/new.ts\n@@\n-old\n+new\n*** Add File: src/created.ts\n+one\n+two\n*** Delete File: src/deleted.ts\n*** End Patch'

describe('marker-based patch display', () => {
  it('deduplicates file paths while accumulating all sections for header/Detail totals', () => {
    const files = parsePatchToolText('*** Begin Patch\n*** Update File: a.ts\n@@\n-old\n+new\n+extra\n*** Update File: a.ts\n@@\n-old2\n+new2\n*** Add File: b.ts\n+one\n+two\n*** End Patch')
    expect(summarizePatchToolFiles(files)).toEqual({ files: 2, added: 5, removed: 2, approximate: false })
    expect(summarizePatchToolFiles([{ path: 'deleted.ts', kind: 'delete', added: 0, removed: 0 }]).approximate).toBe(true)
    expect(summarizePatchToolFiles([{ path: 'deleted.ts', kind: 'delete', added: 0, removed: 4 }]).approximate).toBe(false)
  })

  it('feeds the same per-file Edit/Write/Delete row contract as Claude Bash', () => {
    const files = parsePatchToolText(patch)
    const rows = files.map((file, index) => patchFileToolUse('call', index, file))
    expect(rows.map((row) => row.toolName)).toEqual(['Edit', 'Edit', 'Write', 'Delete'])
    expect(rows.map((row) => row.toolUseId)).toEqual(['call#patch0', 'call#patch1', 'call#patch2', 'call#patch3'])
    expect(JSON.parse(rows[1]!.input).file_path).toBe('src/new.ts')
    expect(JSON.parse(rows[2]!.input).content).toBe('one\ntwo\n')
    expect(rows[3]).toMatchObject({ pathOnly: true, filePath: 'src/deleted.ts' })
  })

  it('extracts file operations, moves and diff rows without treating anchors as source', () => {
    expect(parsePatchToolText(patch)).toEqual([
      { path: 'src/a.ts', kind: 'update', added: 1, removed: 1, diff: '-const enabled = false\n+const enabled = true\n context' },
      { path: 'src/old.ts', movePath: 'src/new.ts', kind: 'update', added: 1, removed: 1, diff: '-old\n+new' },
      { path: 'src/created.ts', kind: 'add', added: 2, removed: 0, diff: '+one\n+two' },
      // Delete markers do not include the deleted file's body; never invent removed lines.
      { path: 'src/deleted.ts', kind: 'delete', added: 0, removed: 0 },
    ])
    expect(patchToolLineDelta({ patchText: patch })).toEqual({ added: 4, removed: 2 })
  })

  it('handles CRLF and partial streaming input without committing an unfinished filename', () => {
    expect(parsePatchToolText(patch.replaceAll('\n', '\r\n'))).toHaveLength(4)
    expect(parsePatchToolText('*** Begin Patch\n*** Update File: src/par')).toEqual([])
    expect(parsePatchToolText('*** Begin Patch\n*** Update File: src/a.ts\n@@\n+new')).toMatchObject([{ path: 'src/a.ts', added: 1 }])
    expect(parsePatchToolText('not a patch')).toEqual([])
  })

  it('validates projected headers and can add diff bodies on detail expansion', () => {
    const files = parsePatchToolText(patch)
    expect(patchToolFiles({ files })).toEqual(files)
    expect(patchToolFiles({ files: [null, { path: 1, kind: 'add' }, { path: 'x', kind: 'invalid' }] })).toEqual([])
    expect(patchToolFiles({ files: [{ path: 'a', kind: 'add', added: -10, removed: Infinity }] })).toEqual([{ path: 'a', kind: 'add', added: 0, removed: 0 }])
  })
})
