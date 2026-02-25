import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockSend = vi.fn()
const mockWatcher = { on: vi.fn(), close: vi.fn() }
let watchCallback: (eventType: string, filename: string | null) => void

vi.mock('fs', () => ({
  watch: vi.fn((_path: string, _opts: unknown, cb: (eventType: string, filename: string | null) => void) => {
    watchCallback = cb
    return mockWatcher
  }),
}))

vi.mock('electron', () => ({
  BrowserWindow: class {},
}))

vi.mock('./logger', () => ({ default: { info: vi.fn(), warn: vi.fn() } }))

const { startWatching, stopWatching } = await import('./file-watcher')

const mockWindow = {
  webContents: { send: mockSend },
} as unknown as import('electron').BrowserWindow

beforeEach(() => {
  stopWatching()
  vi.clearAllMocks()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('file-watcher IGNORED pattern', () => {
  function triggerChange(filename: string) {
    startWatching(mockWindow, '/project')
    vi.clearAllMocks()
    watchCallback('change', filename)
    vi.advanceTimersByTime(500)
  }

  it('should ignore .log files', () => {
    triggerChange('dev.log')
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('should ignore nested .log files', () => {
    triggerChange('logs/app.log')
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('should ignore node_modules', () => {
    triggerChange('node_modules/pkg/index.js')
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('should ignore .git directory', () => {
    triggerChange('.git/objects/abc123')
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('should ignore .DS_Store', () => {
    triggerChange('.DS_Store')
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('should ignore dist directory', () => {
    triggerChange('dist/bundle.js')
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('should emit event for normal source files', () => {
    triggerChange('src/index.ts')
    expect(mockSend).toHaveBeenCalledTimes(1)
  })

  it('should emit event for config files', () => {
    triggerChange('package.json')
    expect(mockSend).toHaveBeenCalledTimes(1)
  })

  it('should not emit for null filename', () => {
    startWatching(mockWindow, '/project')
    vi.clearAllMocks()
    watchCallback('change', null)
    vi.advanceTimersByTime(500)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('should debounce rapid changes', () => {
    startWatching(mockWindow, '/project')
    vi.clearAllMocks()
    watchCallback('change', 'a.ts')
    watchCallback('change', 'b.ts')
    watchCallback('change', 'c.ts')
    vi.advanceTimersByTime(500)
    expect(mockSend).toHaveBeenCalledTimes(1)
  })
})
