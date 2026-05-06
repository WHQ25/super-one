import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  stat: vi.fn(),
}))
vi.mock('fs', () => ({
  watch: vi.fn(),
}))
vi.mock('./logger', () => ({ default: { debug: vi.fn(), warn: vi.fn() } }))
vi.mock('../shared/agent-types', () => ({
  AgentIpcChannels: { BASH_OUTPUT_EVENT: 'bash-output-event' },
}))

import { readFile } from 'fs/promises'
import { tailLines, readBashOutputTail } from './bash-output-watcher'

describe('tailLines', () => {
  it('should return all lines when fewer than max', () => {
    expect(tailLines('a\nb', 5)).toBe('a\nb')
  })

  it('should return all lines when exactly max', () => {
    expect(tailLines('a\nb\nc', 3)).toBe('a\nb\nc')
  })

  it('should return last N lines when more than max', () => {
    expect(tailLines('a\nb\nc\nd\ne', 3)).toBe('c\nd\ne')
  })

  it('should return empty string for empty input', () => {
    expect(tailLines('', 5)).toBe('')
  })

  it('should return single line unchanged', () => {
    expect(tailLines('hello', 5)).toBe('hello')
  })

  it('should preserve trailing newline as an empty last element', () => {
    const text = 'a\nb\nc\n'
    expect(tailLines(text, 3)).toBe('b\nc\n')
  })

  it('should return last N lines including trailing empty line', () => {
    expect(tailLines('a\nb\nc\n', 2)).toBe('c\n')
  })

  it('should return full text when maxLines = 0 (slice(-0) returns all)', () => {
    expect(tailLines('a\nb\nc', 0)).toBe('a\nb\nc')
  })

  it('should handle maxLines = 1 returning only last line', () => {
    expect(tailLines('a\nb\nc', 1)).toBe('c')
  })
})

describe('readBashOutputTail', () => {
  const mockedReadFile = vi.mocked(readFile)

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should read file and return tailed content', async () => {
    mockedReadFile.mockResolvedValue('line1\nline2\nline3\nline4\nline5')
    const result = await readBashOutputTail('/tmp/test.txt', 3)
    expect(result).toBe('line3\nline4\nline5')
    expect(mockedReadFile).toHaveBeenCalledWith('/tmp/test.txt', 'utf-8')
  })

  it('should return full content when lines <= max', async () => {
    mockedReadFile.mockResolvedValue('line1\nline2')
    const result = await readBashOutputTail('/tmp/test.txt', 5)
    expect(result).toBe('line1\nline2')
  })

  it('should return empty string when file not found', async () => {
    mockedReadFile.mockRejectedValue(new Error('ENOENT'))
    const result = await readBashOutputTail('/tmp/nonexistent.txt', 10)
    expect(result).toBe('')
  })

  it('should return full content when exactly at line limit', async () => {
    mockedReadFile.mockResolvedValue('a\nb\nc')
    const result = await readBashOutputTail('/tmp/test.txt', 3)
    expect(result).toBe('a\nb\nc')
  })

  it('should handle empty file', async () => {
    mockedReadFile.mockResolvedValue('')
    const result = await readBashOutputTail('/tmp/test.txt', 5)
    expect(result).toBe('')
  })
})
