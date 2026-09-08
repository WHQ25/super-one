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

async function mount(client: unknown) {
  const runtimeRef = createRef<ChatRuntime>() as { current: ChatRuntime | null }
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
  await waitFor(() => expect(result.current.slashCatalogStatus).toBe('ready'))
  await act(async () => { result.current.update('/') })
  // `/add-dir` rides along: the landing is exactly where the folders a session
  // will start with are still worth changing.
  expect(result.current.slashHits.map((hit) => hit.name)).toEqual(['clear', 'add-dir'])
})

test('reports a catalog the host could not answer for', async () => {
  const client = { request: jest.fn(async () => { throw new Error('offline') }) }
  const { result } = await mount(client)
  await waitFor(() => expect(result.current.slashCatalogStatus).toBe('error'))
})

test('dismissing hides the overlay until the next edit re-arms it', async () => {
  const client = { request: jest.fn(async () => ({ userSlashCommands: [{ name: 'clear' }] })) }
  const { result } = await mount(client)
  await waitFor(() => expect(result.current.slashCatalogStatus).toBe('ready'))

  await act(async () => { result.current.update('/c') })
  expect(result.current.slashHits).toHaveLength(1)

  await act(async () => { result.current.dismissSlash() })
  expect(result.current.slashHits).toEqual([])

  await act(async () => { result.current.update('/cl') })
  expect(result.current.slashHits).toHaveLength(1)
})

test('a draft the app rewrote does not re-open the overlay', async () => {
  const client = { request: jest.fn(async () => ({ userSlashCommands: [{ name: 'clear' }] })) }
  const { result } = await mount(client)
  await waitFor(() => expect(result.current.slashCatalogStatus).toBe('ready'))

  await act(async () => { result.current.update('/c') })
  await act(async () => { result.current.applyProgrammatic('/clear ') })
  expect(result.current.slashHits).toEqual([])
})

test('keeps matching once the draft grows a second line', async () => {
  const client = { request: jest.fn(async () => ({ userSlashCommands: [{ name: 'clear' }] })) }
  const { result } = await mount(client)
  await waitFor(() => expect(result.current.slashCatalogStatus).toBe('ready'))

  await act(async () => { result.current.update('/cl\nand the diff') })
  expect(result.current.slashHits.map((hit) => hit.name)).toEqual(['clear'])
})


test('uses the connection-preloaded catalog without loading or another request', async () => {
  const client = { request: jest.fn(async () => ({ userSlashCommands: [{ name: 'clear' }] })) }
  await preloadHarnessResources(client, '/work/app', ['claude'])
  const { result } = await mount(client)
  expect(result.current.slashCatalogStatus).toBe('ready')
  await act(async () => { result.current.update('/c') })
  expect(result.current.slashHits.map((command) => command.name)).toEqual(['clear'])
  expect(client.request).toHaveBeenCalledTimes(2)
})
