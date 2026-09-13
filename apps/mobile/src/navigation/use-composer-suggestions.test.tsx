import { expect, jest, test } from '@jest/globals'
import { act, renderHook, waitFor } from '@testing-library/react-native'
import { createRef } from 'react'
import type { RelayClient } from '@superone/relay-client'
import type { ChatRuntime } from '../runtime'
import { useComposerSuggestions } from './use-composer-suggestions'
import { preloadHarnessResources } from '../harness-resource-cache'

type Command = { type: string }

/** Resolves `get_system_info` only when the test says so. */
function deferredClient() {
  let release: (() => void) | undefined
  const client = {
    request: jest.fn(async (command: Command) => {
      if (command.type !== 'get_system_info') return {}
      await new Promise<void>((resolve) => { release = resolve })
      return { userSlashCommands: [{ name: 'clear' }, { name: 'compact' }] }
    }),
  }
  return { client, release: () => release?.() }
}

/** The device cache, without the encrypted native store behind it. */
function memoryIconStore() {
  const values = new Map<string, string>()
  return {
    get: async (key: string) => values.get(key) ?? null,
    set: async (key: string, value: string) => { values.set(key, value) },
  }
}

async function mount(client: unknown, runtime: ChatRuntime | null = null) {
  const runtimeRef = createRef<ChatRuntime>() as { current: ChatRuntime | null }
  runtimeRef.current = runtime
  const clientRef = { current: client as RelayClient | null }
  // `renderHook` is async in RNTL 14, like `render`.
  return await renderHook(() =>
    useComposerSuggestions(runtimeRef, 'device:/work/app::claude', {
      client: clientRef,
      projectPath: '/work/app',
      provider: 'claude',
      iconStore: memoryIconStore(),
    }),
  )
}

test('opens the overlay when the catalog lands after the user typed', async () => {
  // The old hook only recomputed on a keystroke, so a catalog that arrived one
  // moment late left the overlay empty until the next character.
  const { client, release } = deferredClient()
  const { result } = await mount(client)

  await act(async () => { result.current.update('/c') })
  expect(result.current.slashCatalogStatus).toBe('loading')
  expect(result.current.slashHits).toEqual([])

  await act(async () => { release() })
  await waitFor(() => expect(result.current.slashCatalogStatus).toBe('ready'))
  // Both are prefix hits; the shorter name wins on the length penalty.
  expect(result.current.slashHits.map((hit) => hit.name)).toEqual(['clear', 'compact'])
})

test('loads a catalog with no session, for the new-session landing', async () => {
  const client = { request: jest.fn(async () => ({ userSlashCommands: [{ name: 'clear' }] })) }
  const { result } = await mount(client)
  await act(async () => { result.current.update('/') })
  await waitFor(() => expect(result.current.slashCatalogStatus).toBe('ready'))
  // `/add-dir` rides along: the landing is exactly where the folders a session
  // will start with are still worth changing.
  expect(result.current.slashHits.map((hit) => hit.name)).toEqual(['clear', 'add-dir'])
})

test('reports a catalog the host could not answer for', async () => {
  const client = { request: jest.fn(async () => { throw new Error('offline') }) }
  const { result } = await mount(client)
  await act(async () => { result.current.update('/') })
  await waitFor(() => expect(result.current.slashCatalogStatus).toBe('error'))
})

test('keeps the catalog load and its failure off screen until a slash is typed', async () => {
  // The load starts with every new session and harness switch; reported
  // unconditionally it flashed a "Loading commands…" strip above an empty input.
  const { client, release } = deferredClient()
  const { result } = await mount(client)
  expect(result.current.slashCatalogStatus).toBe('ready')
  await act(async () => { result.current.update('hello') })
  expect(result.current.slashCatalogStatus).toBe('ready')
  await act(async () => { result.current.update('/') })
  expect(result.current.slashCatalogStatus).toBe('loading')
  await act(async () => { result.current.dismissSlash() })
  expect(result.current.slashCatalogStatus).toBe('ready')
  await act(async () => { release() })
  await act(async () => { result.current.update('/c') })
  await waitFor(() => expect(result.current.slashHits.map((hit) => hit.name)).toEqual(['clear', 'compact']))
})

test('dismissing hides the overlay until the next edit re-arms it', async () => {
  const client = { request: jest.fn(async () => ({ userSlashCommands: [{ name: 'clear' }] })) }
  const { result } = await mount(client)

  await act(async () => { result.current.update('/c') })
  await waitFor(() => expect(result.current.slashHits).toHaveLength(1))

  await act(async () => { result.current.dismissSlash() })
  expect(result.current.slashHits).toEqual([])

  await act(async () => { result.current.update('/cl') })
  expect(result.current.slashHits).toHaveLength(1)
})

test('a toolbar slash inserts at the caret and opens the overlay', async () => {
  const client = { request: jest.fn(async () => ({ userSlashCommands: [{ name: 'clear' }] })) }
  const { result } = await mount(client)
  await waitFor(() => expect(client.request).toHaveBeenCalled())

  let value = ''
  await act(async () => { value = result.current.insertSnippet('/') })

  expect(value).toBe('/')
  await waitFor(() => expect(result.current.slashHits.map((hit) => hit.name)).toEqual(['clear', 'add-dir']))
})

test('a draft the app rewrote does not re-open the overlay', async () => {
  const client = { request: jest.fn(async () => ({ userSlashCommands: [{ name: 'clear' }] })) }
  const { result } = await mount(client)

  await act(async () => { result.current.update('/c') })
  await waitFor(() => expect(result.current.slashHits).toHaveLength(1))
  await act(async () => { result.current.applyProgrammatic('/clear ') })
  expect(result.current.slashHits).toEqual([])
})

test('keeps matching once the draft grows a second line', async () => {
  const client = { request: jest.fn(async () => ({ userSlashCommands: [{ name: 'clear' }] })) }
  const { result } = await mount(client)

  await act(async () => { result.current.update('/cl\nand the diff') })
  await waitFor(() => expect(result.current.slashHits.map((hit) => hit.name)).toEqual(['clear']))
})


test('uses the connection-preloaded catalog without loading or another request', async () => {
  const client = { request: jest.fn(async () => ({ userSlashCommands: [{ name: 'clear' }] })) }
  await preloadHarnessResources(client, '/work/app', ['claude'])
  const { result } = await mount(client)
  await act(async () => { result.current.update('/c') })
  expect(result.current.slashCatalogStatus).toBe('ready')
  expect(result.current.slashHits.map((command) => command.name)).toEqual(['clear'])
  expect(client.request).toHaveBeenCalledTimes(2)
})

const mentionCatalog = {
  agentTargets: [{ ref: 'codex-review', slug: 'review', displayName: 'Code Reviewer' }],
  capabilityIds: ['browser', 'widget'],
  items: [
    { kind: 'miniapp', path: 'board', label: 'Board' },
    { kind: 'agent', path: 'reviewer', model: 'inherit' },
    { kind: 'desktop-app', path: 'com.apple.Safari', label: 'Safari' },
    { kind: 'file', path: 'src/nested.ts' },
    { kind: 'file', path: 'README.md' },
    { kind: 'directory', path: 'src', isDirectory: true },
  ],
}

function mentionClient() {
  return { request: jest.fn(async (command: Command & { path?: string }): Promise<unknown> => {
    if (command.type === 'search_mentions') return mentionCatalog
    if (command.type === 'list_directory') return { items: command.path?.endsWith('/src')
      ? [{ name: 'nested.ts', isDirectory: false }]
      : [{ name: 'src', isDirectory: true }, { name: 'README.md', isDirectory: false }] }
    return {}
  }) }
}

test.each(['typed', 'native', 'toolbar'])('loads collaborators and miniapps on the first bare @ from %s', async (entry) => {
  const client = mentionClient()
  const { result } = await mount(client)
  await act(async () => {
    if (entry === 'native') result.current.updateNative('@', { start: 1, end: 1 }, false)
    else if (entry === 'toolbar') result.current.insertSnippet('@')
    else result.current.update('@')
  })
  await waitFor(() => expect(result.current.mentionSearch.loading).toBe(false))
  const items = result.current.mentionRows.map((row) => row.item)
  expect(items).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'agent-profile', path: 'codex-review' }),
    expect.objectContaining({ kind: 'miniapp', path: 'board' }),
    expect.objectContaining({ kind: 'agent', path: 'reviewer' }),
    expect.objectContaining({ kind: 'dir-entry', path: 'src', isDirectory: true }),
  ]))
  expect(items.filter((item) => item.path === 'README.md')).toHaveLength(1)
  expect(items.some((item) => item.path === 'src/nested.ts' || item.kind === 'desktop-app')).toBe(false)
  expect(result.current.mentionRows.find((row) => row.item.path === 'browser')?.disabled).toBeUndefined()
})

test('the toolbar @ opens the overlay even right after a word', async () => {
  const client = mentionClient()
  const { result } = await mount(client)
  await act(async () => { result.current.updateNative('检查', { start: 2, end: 2 }, false) })
  // The native editor places this itself; the fallback path goes through insertSnippet.
  expect(result.current.snippetAtCursor('@')).toBe(' @')

  let value = ''
  await act(async () => { value = result.current.insertSnippet('@') })

  expect(value).toBe('检查 @')
  expect(result.current.mentionQuery).toBe('')
  await waitFor(() => expect(result.current.mentionSearch.loading).toBe(false))
  expect(result.current.mentionRows.length).toBeGreaterThan(0)
})

test('loads the bare @ catalog through the active runtime and browses its worktree', async () => {
  const client = mentionClient()
  const runtime = {
    mentionRoot: '/work/review-tree',
    searchMentions: jest.fn(async () => mentionCatalog),
  }
  const { result } = await mount(client, runtime as unknown as ChatRuntime)
  await act(async () => { result.current.update('@') })
  await waitFor(() => expect(result.current.mentionSearch.loading).toBe(false))
  expect(runtime.searchMentions).toHaveBeenCalledWith('', {})
  expect(client.request).toHaveBeenCalledWith(expect.objectContaining({ type: 'list_directory', path: '/work/review-tree' }))
  expect(result.current.mentionRows.some((row) => row.item.path === 'board')).toBe(true)
})

test('browses a nested directory without loading unrelated mention targets', async () => {
  const client = mentionClient()
  const { result } = await mount(client)
  await act(async () => { result.current.update('@src/') })
  await waitFor(() => expect(result.current.mentionSearch.loading).toBe(false))
  expect(result.current.mentionRows.map((row) => row.item.path)).toEqual(['src/nested.ts'])
  expect(client.request).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'search_mentions' }))
})

test('restores collaborators and miniapps when a breadcrumb returns to the root', async () => {
  const client = mentionClient()
  const { result } = await mount(client)
  await act(async () => { result.current.update('@src/') })
  await waitFor(() => expect(result.current.mentionSearch.loading).toBe(false))
  await act(async () => { result.current.insert({ kind: 'dir-entry', path: '', navigateTo: '' }) })
  await waitFor(() => expect(result.current.mentionSearch.loading).toBe(false))
  expect(result.current.mentionQuery).toBe('')
  expect(result.current.mentionRows.map((row) => row.item.path)).toEqual(expect.arrayContaining(['codex-review', 'board', 'src']))
})

test('reports a failed root catalog and reloads it on retry', async () => {
  const client = mentionClient()
  const request = client.request.getMockImplementation()!
  let failed = true
  client.request.mockImplementation(async (command) => command.type === 'search_mentions' && failed
    ? { error: 'Host unavailable' } : request(command))
  const { result } = await mount(client)
  await act(async () => { result.current.update('@') })
  await waitFor(() => expect(result.current.mentionSearch.error).toBe('Host unavailable'))
  failed = false
  await act(async () => { result.current.retry() })
  await waitFor(() => expect(result.current.mentionSearch.loading).toBe(false))
  expect(result.current.mentionSearch.error).toBeUndefined()
  expect(result.current.mentionRows.some((row) => row.item.path === 'board')).toBe(true)
})
