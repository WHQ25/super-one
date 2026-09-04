import { describe, expect, it } from 'vitest'
import { formatFileSize, safeSharedFileName } from './shared-file-state'

describe('shared file state', () => {
  it('confines received names to one cache file', () => {
    expect(safeSharedFileName('share:123', '../../private/report.pdf')).toBe('share123-report.pdf')
    expect(safeSharedFileName('', '..')).toBe('received-shared-file')
    expect(safeSharedFileName('s', 'folder\\notes.txt')).toBe('s-notes.txt')
  })

  it('formats byte sizes for the receive sheet', () => {
    expect(formatFileSize(12)).toBe('12 B')
    expect(formatFileSize(1_536)).toBe('1.5 KB')
    expect(formatFileSize(2 * 1_024 * 1_024)).toBe('2.0 MB')
  })
})
