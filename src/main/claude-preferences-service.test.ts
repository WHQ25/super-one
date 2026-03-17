import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn<(path: string) => boolean>(),
  mkdirSync: vi.fn<(path: string, options?: { recursive?: boolean }) => void>(),
  readFileSync: vi.fn<(path: string, encoding: string) => string>(),
  writeFileSync: vi.fn<(path: string, content: string) => void>(),
  homedir: vi.fn<() => string>(),
}))

vi.mock('fs', () => ({
  existsSync: mocks.existsSync,
  mkdirSync: mocks.mkdirSync,
  readFileSync: mocks.readFileSync,
  writeFileSync: mocks.writeFileSync,
}))

vi.mock('os', () => ({
  homedir: mocks.homedir,
}))

import { readUserPreferences, saveUserPreferences, readProjectPreferences, saveProjectPreferences } from './claude-preferences-service'

const CWD = '/mock-project'

describe('user preferences (~/.claude/settings.json)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.homedir.mockReturnValue('/mock-home')
    mocks.existsSync.mockReturnValue(false)
  })

  it('reads outputStyle from user settings', () => {
    mocks.existsSync.mockReturnValue(true)
    mocks.readFileSync.mockReturnValue(JSON.stringify({ outputStyle: 'concise' }))
    expect(readUserPreferences()).toEqual({ outputStyle: 'concise' })
  })

  it('returns empty when missing', () => {
    expect(readUserPreferences()).toEqual({ outputStyle: '' })
  })

  it('saves outputStyle to user settings', () => {
    mocks.existsSync.mockReturnValue(true)
    mocks.readFileSync.mockReturnValue(JSON.stringify({ fastMode: true }))
    expect(saveUserPreferences({ outputStyle: ' detailed ' })).toEqual({ outputStyle: 'detailed' })
    expect(mocks.writeFileSync).toHaveBeenCalledWith(
      '/mock-home/.claude/settings.json',
      JSON.stringify({ fastMode: true, outputStyle: 'detailed' }, null, 2),
    )
  })

  it('removes outputStyle when empty', () => {
    mocks.existsSync.mockReturnValue(true)
    mocks.readFileSync.mockReturnValue(JSON.stringify({ fastMode: true, outputStyle: 'verbose' }))
    expect(saveUserPreferences({ outputStyle: '   ' })).toEqual({ outputStyle: '' })
    expect(mocks.writeFileSync).toHaveBeenCalledWith(
      '/mock-home/.claude/settings.json',
      JSON.stringify({ fastMode: true }, null, 2),
    )
  })
})

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
})
