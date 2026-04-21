import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn<(path: string) => boolean>(),
  mkdirSync: vi.fn<(path: string, options?: { recursive?: boolean }) => void>(),
  readFileSync: vi.fn<(path: string, encoding: string) => string>(),
  writeFileSync: vi.fn<(path: string, content: string) => void>(),
}))

vi.mock('fs', () => ({
  existsSync: mocks.existsSync,
  mkdirSync: mocks.mkdirSync,
  readFileSync: mocks.readFileSync,
  writeFileSync: mocks.writeFileSync,
}))

import { readProjectPreferences, saveProjectPreferences } from './claude-preferences-service'

const CWD = '/mock-project'

describe('project preferences ({cwd}/.claude/settings.local.json)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.existsSync.mockReturnValue(false)
  })

  it('reads outputStyle from project local settings', () => {
    mocks.existsSync.mockReturnValue(true)
    mocks.readFileSync.mockReturnValue(JSON.stringify({ outputStyle: 'Explanatory' }))
    expect(readProjectPreferences(CWD)).toEqual({ outputStyle: 'Explanatory' })
  })

  it('returns empty when missing', () => {
    expect(readProjectPreferences(CWD)).toEqual({ outputStyle: '' })
  })

  it('saves outputStyle to project local settings', () => {
    mocks.existsSync.mockReturnValue(true)
    mocks.readFileSync.mockReturnValue(JSON.stringify({ fastMode: true }))
    expect(saveProjectPreferences(CWD, { outputStyle: 'Learning' })).toEqual({ outputStyle: 'Learning' })
    expect(mocks.mkdirSync).toHaveBeenCalledWith('/mock-project/.claude', { recursive: true })
    expect(mocks.writeFileSync).toHaveBeenCalledWith(
      '/mock-project/.claude/settings.local.json',
      JSON.stringify({ fastMode: true, outputStyle: 'Learning' }, null, 2),
    )
  })

  it('removes outputStyle when empty', () => {
    mocks.existsSync.mockReturnValue(true)
    mocks.readFileSync.mockReturnValue(JSON.stringify({ outputStyle: 'verbose' }))
    expect(saveProjectPreferences(CWD, { outputStyle: '' })).toEqual({ outputStyle: '' })
    expect(mocks.writeFileSync).toHaveBeenCalledWith(
      '/mock-project/.claude/settings.local.json',
      JSON.stringify({}, null, 2),
    )
  })

  it('preserves other fields when saving outputStyle', () => {
    mocks.existsSync.mockReturnValue(true)
    mocks.readFileSync.mockReturnValue(JSON.stringify({ defaultPermissionMode: 'plan', outputStyle: 'old' }))
    expect(saveProjectPreferences(CWD, { outputStyle: 'new' })).toEqual({ outputStyle: 'new' })
    expect(mocks.writeFileSync).toHaveBeenCalledWith(
      '/mock-project/.claude/settings.local.json',
      JSON.stringify({ defaultPermissionMode: 'plan', outputStyle: 'new' }, null, 2),
    )
  })
})
