import { join } from 'path'

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn<(p: string) => boolean>(() => false),
  readFileSync: vi.fn<(p: string, enc: string) => string>(() => '{}'),
  writeFileSync: vi.fn<(p: string, data: string) => void>(),
  mkdirSync: vi.fn(),
  homedir: vi.fn(() => '/mock-home'),
}))

vi.mock('fs', () => ({
  existsSync: mocks.existsSync,
  readFileSync: mocks.readFileSync,
  writeFileSync: mocks.writeFileSync,
  mkdirSync: mocks.mkdirSync,
}))

vi.mock('os', () => ({
  homedir: mocks.homedir,
}))

import { listHooks, saveHook, deleteHook } from './hooks-config-service'

const CWD = '/test/project'
const USER_SETTINGS = join('/mock-home', '.claude', 'settings.json')
const PROJECT_SETTINGS = join(CWD, '.claude', 'settings.json')
const LOCAL_SETTINGS = join(CWD, '.claude', 'settings.local.json')

function mockFiles(files: Record<string, unknown>) {
  const fs: Record<string, unknown> = { ...files }
  mocks.existsSync.mockImplementation((p: string) => p in fs)
  mocks.readFileSync.mockImplementation((p: string) => {
    if (p in fs) return JSON.stringify(fs[p])
    throw new Error('ENOENT')
  })
  mocks.writeFileSync.mockImplementation((p: string, data: string) => {
    fs[p] = JSON.parse(data)
  })
}

function writtenJson(call: number): { path: string; data: Record<string, unknown> } {
  const c = mocks.writeFileSync.mock.calls[call]
  return { path: c[0] as string, data: JSON.parse(c[1] as string) }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('listHooks', () => {
  it('flattens hooks from all 3 scopes with stable IDs', () => {
    mockFiles({
      [USER_SETTINGS]: {
        hooks: {
          PreToolUse: [
            { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo bash' }] },
          ],
        },
      },
      [PROJECT_SETTINGS]: {
        hooks: {
          Stop: [{ hooks: [{ type: 'command', command: 'echo stop' }] }],
        },
      },
      [LOCAL_SETTINGS]: {
        hooks: {
          PostToolUse: [
            { matcher: 'Write', hooks: [{ type: 'prompt', prompt: 'verify' }] },
          ],
        },
      },
    })

    const result = listHooks(CWD)

    expect(result).toHaveLength(3)
    expect(result[0]).toMatchObject({
      id: 'user:PreToolUse:0:0',
      scope: 'user',
      event: 'PreToolUse',
      matcher: 'Bash',
      entry: { type: 'command', command: 'echo bash' },
    })
    expect(result[1]).toMatchObject({
      id: 'project:Stop:0:0',
      scope: 'project',
      event: 'Stop',
      matcher: undefined,
    })
    expect(result[2]).toMatchObject({
      id: 'local:PostToolUse:0:0',
      scope: 'local',
      event: 'PostToolUse',
      matcher: 'Write',
      entry: { type: 'prompt', prompt: 'verify' },
    })
  })

  it('returns empty array when no files exist', () => {
    mockFiles({})
    expect(listHooks(CWD)).toEqual([])
  })

  it('handles malformed JSON gracefully', () => {
    mocks.existsSync.mockReturnValue(true)
    mocks.readFileSync.mockReturnValue('not valid json')
    expect(listHooks(CWD)).toEqual([])
  })

  it('expands multiple matcher groups and entries within an event', () => {
    mockFiles({
      [USER_SETTINGS]: {
        hooks: {
          PreToolUse: [
            { matcher: 'Bash', hooks: [
              { type: 'command', command: 'a' },
              { type: 'command', command: 'b' },
            ] },
            { matcher: 'Write', hooks: [{ type: 'command', command: 'c' }] },
          ],
        },
      },
    })

    const result = listHooks(CWD)
    expect(result.map((h) => h.id)).toEqual([
      'user:PreToolUse:0:0',
      'user:PreToolUse:0:1',
      'user:PreToolUse:1:0',
    ])
  })
})

describe('saveHook', () => {
  it('creates hooks structure when settings.json is empty', () => {
    mockFiles({})

    saveHook(CWD, {
      scope: 'user',
      event: 'PreToolUse',
      matcher: 'Bash',
      entry: { type: 'command', command: 'echo hi' },
    })

    const { path, data } = writtenJson(0)
    expect(path).toBe(USER_SETTINGS)
    expect(data).toEqual({
      hooks: {
        PreToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo hi' }] },
        ],
      },
    })
  })

  it('appends entry to existing matcher group when matcher matches', () => {
    mockFiles({
      [USER_SETTINGS]: {
        hooks: {
          PreToolUse: [
            { matcher: 'Bash', hooks: [{ type: 'command', command: 'first' }] },
          ],
        },
      },
    })

    saveHook(CWD, {
      scope: 'user',
      event: 'PreToolUse',
      matcher: 'Bash',
      entry: { type: 'command', command: 'second' },
    })

    const { data } = writtenJson(0)
    const hooks = (data.hooks as { PreToolUse: { matcher: string; hooks: unknown[] }[] }).PreToolUse
    expect(hooks).toHaveLength(1)
    expect(hooks[0].hooks).toHaveLength(2)
    expect(hooks[0].hooks[1]).toMatchObject({ command: 'second' })
  })

  it('creates a new matcher group when matcher differs', () => {
    mockFiles({
      [USER_SETTINGS]: {
        hooks: {
          PreToolUse: [
            { matcher: 'Bash', hooks: [{ type: 'command', command: 'first' }] },
          ],
        },
      },
    })

    saveHook(CWD, {
      scope: 'user',
      event: 'PreToolUse',
      matcher: 'Write',
      entry: { type: 'command', command: 'second' },
    })

    const { data } = writtenJson(0)
    const groups = (data.hooks as { PreToolUse: unknown[] }).PreToolUse
    expect(groups).toHaveLength(2)
  })

  it('preserves unrelated fields in settings.json', () => {
    mockFiles({
      [USER_SETTINGS]: {
        fastMode: true,
        someOther: { keep: 'me' },
      },
    })

    saveHook(CWD, {
      scope: 'user',
      event: 'Stop',
      entry: { type: 'command', command: 'done' },
    })

    const { data } = writtenJson(0)
    expect(data.fastMode).toBe(true)
    expect(data.someOther).toEqual({ keep: 'me' })
    expect(data.hooks).toBeDefined()
  })

  it('writes to project settings when scope=project', () => {
    mockFiles({})

    saveHook(CWD, {
      scope: 'project',
      event: 'Stop',
      entry: { type: 'command', command: 'p' },
    })

    expect(writtenJson(0).path).toBe(PROJECT_SETTINGS)
  })

  it('writes to settings.local.json when scope=local', () => {
    mockFiles({})

    saveHook(CWD, {
      scope: 'local',
      event: 'Stop',
      entry: { type: 'command', command: 'l' },
    })

    expect(writtenJson(0).path).toBe(LOCAL_SETTINGS)
  })

  it('replaces existing hook when replaceId is provided', () => {
    const initial = {
      hooks: {
        PreToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: 'old' }] },
        ],
      },
    }
    mockFiles({ [USER_SETTINGS]: initial })

    saveHook(
      CWD,
      {
        scope: 'user',
        event: 'PreToolUse',
        matcher: 'Bash',
        entry: { type: 'command', command: 'new' },
      },
      'user:PreToolUse:0:0',
    )

    expect(mocks.writeFileSync).toHaveBeenCalledTimes(2)
    const { data } = writtenJson(1)
    const groups = (data.hooks as { PreToolUse: { hooks: { command: string }[] }[] }).PreToolUse
    expect(groups[0].hooks).toHaveLength(1)
    expect(groups[0].hooks[0].command).toBe('new')
  })
})

describe('deleteHook', () => {
  it('removes a single entry within a multi-entry group', () => {
    mockFiles({
      [USER_SETTINGS]: {
        hooks: {
          PreToolUse: [
            { matcher: 'Bash', hooks: [
              { type: 'command', command: 'a' },
              { type: 'command', command: 'b' },
            ] },
          ],
        },
      },
    })

    deleteHook(CWD, 'user:PreToolUse:0:0')

    const { data } = writtenJson(0)
    const groups = (data.hooks as { PreToolUse: { hooks: { command: string }[] }[] }).PreToolUse
    expect(groups[0].hooks).toHaveLength(1)
    expect(groups[0].hooks[0].command).toBe('b')
  })

  it('removes the matcher group when its last entry is deleted', () => {
    mockFiles({
      [USER_SETTINGS]: {
        hooks: {
          PreToolUse: [
            { matcher: 'Bash', hooks: [{ type: 'command', command: 'a' }] },
            { matcher: 'Write', hooks: [{ type: 'command', command: 'b' }] },
          ],
        },
      },
    })

    deleteHook(CWD, 'user:PreToolUse:0:0')

    const { data } = writtenJson(0)
    const groups = (data.hooks as { PreToolUse: { matcher: string }[] }).PreToolUse
    expect(groups).toHaveLength(1)
    expect(groups[0].matcher).toBe('Write')
  })

  it('removes the event key when its last group is empty', () => {
    mockFiles({
      [USER_SETTINGS]: {
        hooks: {
          PreToolUse: [
            { matcher: 'Bash', hooks: [{ type: 'command', command: 'a' }] },
          ],
          Stop: [{ hooks: [{ type: 'command', command: 'b' }] }],
        },
      },
    })

    deleteHook(CWD, 'user:PreToolUse:0:0')

    const { data } = writtenJson(0)
    expect(data.hooks).toEqual({
      Stop: [{ hooks: [{ type: 'command', command: 'b' }] }],
    })
  })

  it('removes the hooks key entirely when last event is gone', () => {
    mockFiles({
      [USER_SETTINGS]: {
        fastMode: true,
        hooks: {
          PreToolUse: [
            { matcher: 'Bash', hooks: [{ type: 'command', command: 'a' }] },
          ],
        },
      },
    })

    deleteHook(CWD, 'user:PreToolUse:0:0')

    const { data } = writtenJson(0)
    expect(data.hooks).toBeUndefined()
    expect(data.fastMode).toBe(true)
  })

  it('is a no-op for an unknown ID', () => {
    mockFiles({
      [USER_SETTINGS]: {
        hooks: {
          PreToolUse: [
            { matcher: 'Bash', hooks: [{ type: 'command', command: 'a' }] },
          ],
        },
      },
    })

    deleteHook(CWD, 'user:PreToolUse:5:5')

    expect(mocks.writeFileSync).not.toHaveBeenCalled()
  })

  it('rejects malformed IDs without writing', () => {
    deleteHook(CWD, 'not-a-valid-id')
    expect(mocks.writeFileSync).not.toHaveBeenCalled()
  })
})
