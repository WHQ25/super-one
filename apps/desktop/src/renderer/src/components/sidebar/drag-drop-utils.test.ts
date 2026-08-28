import { describe, it, expect } from 'vitest'
import {
  getDropAction,
  getTargetDir,
  isChildPath,
  isWithinFolder,
  toAbsolutePath,
  shouldCollapseAutoExpanded,
  computeDropOverlay,
  getDropTargetName,
} from './drag-drop-utils'

describe('getDropAction', () => {
  it('should always move for internal drags', () => {
    expect(getDropAction(true, false)).toBe('move')
    expect(getDropAction(true, true)).toBe('move')
  })

  it('should copy by default for external drags', () => {
    expect(getDropAction(false, false)).toBe('copy')
  })

  it('should move for external drags with alt key', () => {
    expect(getDropAction(false, true)).toBe('move')
  })
})

describe('getTargetDir', () => {
  it('should return path itself for directories', () => {
    expect(getTargetDir('src/components', true)).toBe('src/components')
  })

  it('should return parent dir for files', () => {
    expect(getTargetDir('src/components/Button.tsx', false)).toBe('src/components')
  })

  it('should return empty string for root-level files', () => {
    expect(getTargetDir('README.md', false)).toBe('')
  })

  it('should return parent for single-level nested files', () => {
    expect(getTargetDir('src/index.ts', false)).toBe('src')
  })
})

describe('isChildPath', () => {
  it('should return true for direct children', () => {
    expect(isChildPath('src', 'src/index.ts')).toBe(true)
  })

  it('should return true for nested children', () => {
    expect(isChildPath('src', 'src/components/Button.tsx')).toBe(true)
  })

  it('should return false for same path', () => {
    expect(isChildPath('src', 'src')).toBe(false)
  })

  it('should return false for sibling with same prefix', () => {
    expect(isChildPath('src', 'src-old/file.ts')).toBe(false)
  })

  it('should return false for unrelated paths', () => {
    expect(isChildPath('src', 'lib/utils.ts')).toBe(false)
  })
})

describe('isWithinFolder', () => {
  it('returns true when path equals folder', () => {
    expect(isWithinFolder('/projects/app', '/projects/app')).toBe(true)
  })

  it('returns true for nested file', () => {
    expect(isWithinFolder('/projects/app/src/index.ts', '/projects/app')).toBe(true)
  })

  it('returns false for sibling sharing prefix', () => {
    expect(isWithinFolder('/projects/app-old/file.ts', '/projects/app')).toBe(false)
  })

  it('returns false for unrelated path', () => {
    expect(isWithinFolder('/other/file.ts', '/projects/app')).toBe(false)
  })

  it('handles trailing slash on folder', () => {
    expect(isWithinFolder('/projects/app/src/index.ts', '/projects/app/')).toBe(true)
  })
})

describe('toAbsolutePath', () => {
  it('returns folder when relative is empty', () => {
    expect(toAbsolutePath('/projects/app', '')).toBe('/projects/app')
  })

  it('returns folder when relative is dot', () => {
    expect(toAbsolutePath('/projects/app', '.')).toBe('/projects/app')
  })

  it('joins folder and relative with slash', () => {
    expect(toAbsolutePath('/projects/app', 'src/index.ts')).toBe('/projects/app/src/index.ts')
  })

  it('passes through absolute path', () => {
    expect(toAbsolutePath('/projects/app', '/other/file.ts')).toBe('/other/file.ts')
  })

  it('handles trailing slash on folder', () => {
    expect(toAbsolutePath('/projects/app/', 'src/index.ts')).toBe('/projects/app/src/index.ts')
  })
})

describe('shouldCollapseAutoExpanded', () => {
  it('should collapse when dragOverPath is null', () => {
    expect(shouldCollapseAutoExpanded('src', null)).toBe(true)
  })

  it('should not collapse when hovering the folder itself', () => {
    expect(shouldCollapseAutoExpanded('src', 'src')).toBe(false)
  })

  it('should not collapse when hovering a child path', () => {
    expect(shouldCollapseAutoExpanded('src', 'src/components')).toBe(false)
    expect(shouldCollapseAutoExpanded('src', 'src/components/Button.tsx')).toBe(false)
  })

  it('should collapse when hovering a different folder', () => {
    expect(shouldCollapseAutoExpanded('src', 'lib')).toBe(true)
  })

  it('should collapse when hovering a sibling with same prefix', () => {
    expect(shouldCollapseAutoExpanded('src', 'src-old')).toBe(true)
  })
})

describe('computeDropOverlay', () => {
  const paths = ['src', 'src/index.ts', 'src/components', 'src/components/Button.tsx', 'lib', 'lib/utils.ts']
  const rowH = 28

  it('should return null when dragOverPath is null', () => {
    expect(computeDropOverlay(null, paths, rowH)).toBeNull()
  })

  it('should cover folder and all children', () => {
    expect(computeDropOverlay('src', paths, rowH)).toEqual({ top: 0, height: 4 * rowH })
  })

  it('should cover subfolder and its children', () => {
    expect(computeDropOverlay('src/components', paths, rowH)).toEqual({ top: 2 * rowH, height: 2 * rowH })
  })

  it('should cover single folder with no visible children', () => {
    expect(computeDropOverlay('lib', paths, rowH)).toEqual({ top: 4 * rowH, height: 2 * rowH })
  })

  it('should return null when path not found', () => {
    expect(computeDropOverlay('nonexistent', paths, rowH)).toBeNull()
  })
})


describe('getDropTargetName', () => {
  it('names the project root when no row is hovered', () => {
    expect(getDropTargetName(null, 'super-one')).toBe('super-one')
    expect(getDropTargetName('', 'super-one')).toBe('super-one')
  })

  it('names a top-level folder by itself', () => {
    expect(getDropTargetName('scripts', 'super-one')).toBe('scripts')
  })

  it('names a nested folder by its basename only', () => {
    expect(getDropTargetName('apps/desktop/src', 'super-one')).toBe('src')
  })
})
