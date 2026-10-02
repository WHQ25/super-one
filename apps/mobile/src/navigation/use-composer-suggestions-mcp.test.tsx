import { expect, jest, test } from '@jest/globals'
import { act, renderHook, waitFor } from '@testing-library/react-native'
import type { RelayClient } from '@superone/relay-client'
import type { ChatRuntime } from '../runtime'
import { useComposerSuggestions } from './use-composer-suggestions'

type Command = { type: string; query?: string; sessionId?: string }

function hostClient() {
  return {
    request: jest.fn(async (command: Command) => command.type === 'search_mcp_mentions'
      ? { sources: [{ server: 'bits', tool: 'search_parts', title: 'Bits CAD', items: [{ uri: 'cad://parts/hex-bolt', label: 'Hex bolt' }] }] }
      : {}),
  }
}

async function mount(client: ReturnType<typeof hostClient>, sessionId: string | null) {
  const runtimeRef = { current: null as ChatRuntime | null }
  const clientRef = { current: client as unknown as RelayClient }
  const store = { get: async () => null, set: async () => {} }
  return await renderHook(() => useComposerSuggestions(runtimeRef, `device:/work/app:${sessionId}:claude`, {
    client: clientRef, projectPath: '/work/app', provider: 'claude', sessionId, iconStore: store,
  }))
}

const mcpRequests = (client: ReturnType<typeof hostClient>) =>
  client.request.mock.calls.map(([command]) => command).filter((command) => command.type === 'search_mcp_mentions')

test("asks the session's servers and lists what they answer", async () => {
  const client = hostClient()
  const { result } = await mount(client, 'session-1')
  await act(async () => { result.current.update('@hex') })
  await waitFor(() => expect(result.current.mentionRows.some((row) => row.item.kind === 'mcp-resource')).toBe(true))
  expect(mcpRequests(client).at(-1)).toMatchObject({ sessionId: 'session-1', query: 'hex' })
  expect(result.current.mcpMentions?.sources.map((source) => source.title)).toEqual(['Bits CAD'])
})

test('asks no server before a session exists or inside a portal', async () => {
  const landing = hostClient()
  const { result } = await mount(landing, null)
  await act(async () => { result.current.update('@hex') })
  const open = hostClient()
  const session = await mount(open, 'session-1')
  await act(async () => { session.result.current.update('@session ') })
  await new Promise((resolve) => setTimeout(resolve, 400))
  expect(mcpRequests(landing)).toEqual([])
  expect(mcpRequests(open)).toEqual([])
  expect(result.current.mcpMentions).toEqual(expect.objectContaining({ sources: [] }))
})
