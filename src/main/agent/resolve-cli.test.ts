import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  execFileSyncMock,
  spawnSyncMock,
  resolveMock,
  logInfoMock,
  logWarnMock,
  existsSyncMock,
} = vi.hoisted(() => ({
  execFileSyncMock: vi.fn(),
  spawnSyncMock: vi.fn(),
  resolveMock: vi.fn(),
  logInfoMock: vi.fn(),
  logWarnMock: vi.fn(),
  existsSyncMock: vi.fn(() => false),
}))

vi.mock('child_process', () => ({
  execFileSync: execFileSyncMock,
  spawnSync: spawnSyncMock,
}))

vi.mock('module', () => ({
  createRequire: () => ({
    resolve: resolveMock,
  }),
}))

vi.mock('node:fs', () => ({
  existsSync: existsSyncMock,
}))

vi.mock('@electron-toolkit/utils', () => ({
  is: { dev: true },
}))

vi.mock('../logger', () => ({
  default: {
    info: logInfoMock,
    warn: logWarnMock,
  },
}))

import { clearCliCache, dedupePath, findSystemClaude, getClaudeCliPath } from './resolve-cli'

const originalPlatform = process.platform

describe('resolve-cli', () => {
  beforeEach(() => {
    execFileSyncMock.mockReset()
    spawnSyncMock.mockReset()
    resolveMock.mockReset()
    logInfoMock.mockReset()
    logWarnMock.mockReset()
    clearCliCache()
    Object.defineProperty(process, 'platform', { value: originalPlatform })
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform })
  })

  it('uses where + spawnSync for windows cmd entry', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    execFileSyncMock.mockReturnValue(Buffer.from('C:\\Users\\u\\AppData\\Roaming\\npm\\claude.cmd\r\n'))
    spawnSyncMock.mockReturnValue({ status: 0, error: undefined })

    const result = findSystemClaude()

    expect(result).toBe('C:\\Users\\u\\AppData\\Roaming\\npm\\claude.cmd')
    expect(execFileSyncMock).toHaveBeenCalledWith('where', ['claude'], { timeout: 3000, stdio: 'pipe' })
    expect(spawnSyncMock).toHaveBeenCalledWith(
      'C:\\Users\\u\\AppData\\Roaming\\npm\\claude.cmd',
      ['--version'],
      expect.objectContaining({ shell: true, windowsHide: true }),
    )
  })

  it('tries next windows candidate when previous probe fails', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    execFileSyncMock.mockReturnValue(Buffer.from('C:\\a\\claude.cmd\r\nC:\\b\\claude.cmd\r\n'))
    spawnSyncMock
      .mockReturnValueOnce({ status: 1, error: undefined })
      .mockReturnValueOnce({ status: 0, error: undefined })

    const result = findSystemClaude()

    expect(result).toBe('C:\\b\\claude.cmd')
    expect(spawnSyncMock).toHaveBeenCalledTimes(2)
  })

  it('falls back to sdk cli and rewrites windows app.asar path', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    execFileSyncMock.mockImplementation(() => { throw new Error('where failed') })
    resolveMock.mockReturnValue('C:\\App\\resources\\app.asar\\node_modules\\@anthropic-ai\\claude-agent-sdk\\cli.js')

    const result = getClaudeCliPath()

    expect(result).toBe('C:\\App\\resources\\app.asar.unpacked\\node_modules\\@anthropic-ai\\claude-agent-sdk\\cli.js')
  })

  it('uses system claude path on non-windows', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    execFileSyncMock
      .mockReturnValueOnce(Buffer.from('/usr/local/bin/claude\n'))
      .mockReturnValueOnce(Buffer.from('2.0.0\n'))

    const result = findSystemClaude()

    expect(result).toBe('/usr/local/bin/claude')
    expect(spawnSyncMock).not.toHaveBeenCalled()
  })
})

describe('dedupePath', () => {
  it('removes duplicate entries preserving first-seen order', () => {
    expect(dedupePath('/a:/b:/a:/c:/b')).toBe('/a:/b:/c')
  })

  it('drops empty entries from leading/trailing/adjacent colons', () => {
    expect(dedupePath(':/a::/b:')).toBe('/a:/b')
  })

  it('returns empty string for empty input', () => {
    expect(dedupePath('')).toBe('')
  })

  it('handles real-world bloated PATH with repeated inits', () => {
    const bloated = [
      '/Users/jeff/.antigravity/antigravity/bin',
      '/Users/jeff/.antigravity/antigravity/bin',
      '/Users/jeff/.cargo/bin',
      '/opt/homebrew/bin',
      '/Users/jeff/.cargo/bin',
      '/opt/homebrew/bin',
    ].join(':')
    const result = dedupePath(bloated)
    expect(result).toBe('/Users/jeff/.antigravity/antigravity/bin:/Users/jeff/.cargo/bin:/opt/homebrew/bin')
    expect(result.length).toBeLessThan(bloated.length)
  })
})
