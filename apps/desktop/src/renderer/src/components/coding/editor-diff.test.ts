import { describe, expect, it } from 'vitest'
import { createTwoFilesPatch } from 'diff'
import {
  buildEditorMinimapLines,
  computeLiveDiffChanges,
  findChangeForGutterLine,
  parseEditorDiffChanges,
  reconstructBaseContent,
  revertDiffChange,
} from './editor-diff'

describe('editor-diff', () => {
  it('splits a context hunk into separate modified, deleted, and added blocks', () => {
    const base = 'l1\nl2\nl3\nl4\nl5\nl6\nl7\n'
    const current = 'l1\nL2A\nL2B\nl3\nl4\nl6\nl7\nL8\n'
    const patch = createTwoFilesPatch('a/f.ts', 'b/f.ts', base, current)
    const changes = parseEditorDiffChanges(patch, 8)

    expect(changes).toHaveLength(3)
    expect(changes[0]).toMatchObject({
      kind: 'modified',
      oldLines: ['l2'],
      newLines: ['L2A', 'L2B'],
      newStartLine: 2,
      newEndLine: 3,
      anchorLine: 2,
    })
    expect(changes[1]).toMatchObject({
      kind: 'deleted',
      oldLines: ['l5'],
      newLines: [],
      newStartLine: 6,
      anchorLine: 5,
      deletePosition: 'below',
    })
    expect(changes[2]).toMatchObject({
      kind: 'added',
      oldLines: [],
      newLines: ['L8'],
      newStartLine: 8,
      newEndLine: 8,
      anchorLine: 8,
    })
  })

  it('marks top-of-file deletions with deletePosition above on line 1', () => {
    const base = 'first\nsecond\nthird\n'
    const current = 'third\n'
    const patch = createTwoFilesPatch('a/f.ts', 'b/f.ts', base, current)
    const changes = parseEditorDiffChanges(patch, 1)

    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({
      kind: 'deleted',
      oldLines: ['first', 'second'],
      anchorLine: 1,
      deletePosition: 'above',
    })
    expect(revertDiffChange(current, changes[0])).toBe(base)
  })

  it('handles deleting both above and below line 1 independently', () => {
    const base = 'top\nkeep\nbottom\n'
    const current = 'keep\n'
    const changes = computeLiveDiffChanges(base, current)

    expect(changes).toHaveLength(2)
    const topChange = findChangeForGutterLine(changes, 1, 'top')
    const bottomChange = findChangeForGutterLine(changes, 1, 'bottom')
    expect(topChange?.oldLines).toEqual(['top'])
    expect(bottomChange?.oldLines).toEqual(['bottom'])
  })

  it('reconstructs base content preserving trailing newline states', () => {
    const baseWithNl = 'const a = 1\nconst b = 2\n'
    const modWithNl = 'const a = 1\nconst b = 3\n'
    const diff1 = createTwoFilesPatch('a', 'b', baseWithNl, modWithNl)
    expect(reconstructBaseContent(modWithNl, diff1)).toBe(baseWithNl)

    const baseNoNl = 'const a = 1\nconst b = 2'
    const diff2 = createTwoFilesPatch('a', 'b', baseNoNl, modWithNl)
    expect(reconstructBaseContent(modWithNl, diff2)).toBe(baseNoNl)

    const modNoNl = 'const a = 1\nconst b = 3'
    const diff3 = createTwoFilesPatch('a', 'b', baseWithNl, modNoNl)
    expect(reconstructBaseContent(modNoNl, diff3)).toBe(baseWithNl)
  })

  it('reverts added, modified, and deleted changes back to base content', () => {
    const base = 'alpha\nbeta\ngamma\ndelta\n'
    const current = 'alpha\nBETA_1\nBETA_2\ngamma\nepsilon\n'
    const changes = computeLiveDiffChanges(base, current)
    expect(changes).toHaveLength(2)

    const afterFirstRevert = revertDiffChange(current, changes[1])
    expect(afterFirstRevert).toBe('alpha\nBETA_1\nBETA_2\ngamma\ndelta\n')

    const remaining = computeLiveDiffChanges(base, afterFirstRevert)
    expect(remaining).toHaveLength(1)
    expect(revertDiffChange(afterFirstRevert, remaining[0])).toBe(base)
  })

  it('handles reverting when entire file content was deleted', () => {
    const base = 'line1\nline2\n'
    const current = ''
    const patch = createTwoFilesPatch('a', 'b', base, current)
    const changes = parseEditorDiffChanges(patch, 0)
    expect(changes).toHaveLength(1)
    expect(reconstructBaseContent(current, patch)).toBe(base)
    expect(revertDiffChange(current, changes[0])).toBe(base)
  })

  it('builds minimap lines aligned with current file lines and diff indicators', () => {
    const base = 'first\nkeep\noldVal\nmid\nremoved\ntail\n'
    const current = 'keep\nnewVal\nmid\ntail\nadded\n'
    const changes = computeLiveDiffChanges(base, current)
    const minimap = buildEditorMinimapLines(current, changes)

    expect(minimap).toHaveLength(5)
    expect(minimap[0]).toMatchObject({ lineNum: 1, kind: 'unchanged', deletedAbove: true })
    expect(minimap[1]).toMatchObject({ lineNum: 2, kind: 'modified' })
    expect(minimap[2]).toMatchObject({ lineNum: 3, kind: 'unchanged', deletedBelow: true })
    expect(minimap[3]).toMatchObject({ lineNum: 4, kind: 'unchanged' })
    expect(minimap[4]).toMatchObject({ lineNum: 5, kind: 'added' })
  })
})
