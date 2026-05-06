import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn<(path: string) => boolean>(),
  readFileSync: vi.fn<(path: string, encoding: string) => string>(),
  writeFileSync: vi.fn<(path: string, content: string) => void>(),
}))

vi.mock('electron', () => ({ app: { getPath: () => '/mock-user-data' } }))

vi.mock('fs', () => ({
  existsSync: mocks.existsSync,
  readFileSync: mocks.readFileSync,
  writeFileSync: mocks.writeFileSync,
}))

import { getSessionTitles, setSessionTitle, deleteSessionTitle } from './session-titles'

const FILE_PATH = '/mock-user-data/session-titles.json'

describe('getSessionTitles', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns parsed object when file exists with valid JSON', () => {
    mocks.existsSync.mockReturnValue(true)
    mocks.readFileSync.mockReturnValue(JSON.stringify({ s1: 'Title 1', s2: 'Title 2' }))
    expect(getSessionTitles()).toEqual({ s1: 'Title 1', s2: 'Title 2' })
    expect(mocks.readFileSync).toHaveBeenCalledWith(FILE_PATH, 'utf-8')
  })

  it('returns empty object when file is missing', () => {
    mocks.existsSync.mockReturnValue(false)
    expect(getSessionTitles()).toEqual({})
    expect(mocks.readFileSync).not.toHaveBeenCalled()
  })

  it('returns empty object when file has invalid JSON', () => {
    mocks.existsSync.mockReturnValue(true)
    mocks.readFileSync.mockReturnValue('not json{{{')
    expect(getSessionTitles()).toEqual({})
  })
})

describe('setSessionTitle', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sets title in existing file', () => {
    mocks.existsSync.mockReturnValue(true)
    mocks.readFileSync.mockReturnValue(JSON.stringify({ s1: 'Old' }))
    setSessionTitle('s2', 'New')
    expect(mocks.writeFileSync).toHaveBeenCalledWith(
      FILE_PATH,
      JSON.stringify({ s1: 'Old', s2: 'New' }, null, 2),
    )
  })

  it('creates file content when file is missing', () => {
    mocks.existsSync.mockReturnValue(false)
    setSessionTitle('s1', 'First')
    expect(mocks.writeFileSync).toHaveBeenCalledWith(
      FILE_PATH,
      JSON.stringify({ s1: 'First' }, null, 2),
    )
  })

  it('overwrites existing title for same sessionId', () => {
    mocks.existsSync.mockReturnValue(true)
    mocks.readFileSync.mockReturnValue(JSON.stringify({ s1: 'Old Title' }))
    setSessionTitle('s1', 'Updated Title')
    expect(mocks.writeFileSync).toHaveBeenCalledWith(
      FILE_PATH,
      JSON.stringify({ s1: 'Updated Title' }, null, 2),
    )
  })
})

describe('deleteSessionTitle', () => {
  beforeEach(() => vi.clearAllMocks())

  it('deletes existing title', () => {
    mocks.existsSync.mockReturnValue(true)
    mocks.readFileSync.mockReturnValue(JSON.stringify({ s1: 'Keep', s2: 'Remove' }))
    deleteSessionTitle('s2')
    expect(mocks.writeFileSync).toHaveBeenCalledWith(
      FILE_PATH,
      JSON.stringify({ s1: 'Keep' }, null, 2),
    )
  })

  it('no-op write for non-existing sessionId', () => {
    mocks.existsSync.mockReturnValue(true)
    mocks.readFileSync.mockReturnValue(JSON.stringify({ s1: 'Keep' }))
    deleteSessionTitle('nonexistent')
    expect(mocks.writeFileSync).toHaveBeenCalledWith(
      FILE_PATH,
      JSON.stringify({ s1: 'Keep' }, null, 2),
    )
  })

  it('handles missing file gracefully', () => {
    mocks.existsSync.mockReturnValue(false)
    deleteSessionTitle('any')
    expect(mocks.writeFileSync).toHaveBeenCalledWith(
      FILE_PATH,
      JSON.stringify({}, null, 2),
    )
  })
})
