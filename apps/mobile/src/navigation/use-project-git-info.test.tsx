import { expect, jest, test } from '@jest/globals'
import { act, renderHook, waitFor } from '@testing-library/react-native'
import { useRef } from 'react'
import type { RelayClient } from '@superone/relay-client'
import { useProjectGitInfo } from './use-project-git-info'

function renderGit(client: RelayClient, session: { sessionId: string | null; streaming: boolean }) {
  // `renderHook` is async in RNTL 14, like `render`.
  return renderHook(
    (props: { sessionId: string | null; streaming: boolean }) => {
      const clientRef = useRef(client)
      clientRef.current = client
      return useProjectGitInfo({
        clientRef,
        projectPath: '/repo',
        sessionId: props.sessionId,
        streaming: props.streaming,
      })
    },
    { initialProps: session },
  )
}

test('a turn ending on the open session refreshes git status', async () => {
  const request = jest.fn(async () => ({ branch: 'main', dirty: { files: 3, insertions: 10, deletions: 2 } }))
  const client = { request } as unknown as RelayClient
  const { result, rerender } = await renderGit(client, { sessionId: 's1', streaming: true })

  expect(request).not.toHaveBeenCalled()
  await rerender({ sessionId: 's1', streaming: false })
  await waitFor(() => expect(request).toHaveBeenCalledTimes(1))
  expect(request).toHaveBeenCalledWith(expect.objectContaining({ type: 'get_git_info', projectPath: '/repo' }))
  expect(result.current.gitInfo?.dirty?.files).toBe(3)
})

test('refresh is how switching back or opening the git page re-reads the tree', async () => {
  const request = jest.fn(async () => ({ branch: 'main', dirty: { files: 1, insertions: 2, deletions: 0 } }))
  const client = { request } as unknown as RelayClient
  const { result } = await renderGit(client, { sessionId: 's1', streaming: false })

  await act(() => result.current.refresh('/repo'))
  expect(request).toHaveBeenCalledWith(expect.objectContaining({ type: 'get_git_info', projectPath: '/repo' }))
  expect(result.current.gitInfo?.dirty?.files).toBe(1)
})

test('switching sessions does not count as a turn ending', async () => {
  const request = jest.fn(async () => ({ branch: 'main' }))
  const client = { request } as unknown as RelayClient
  const { rerender } = await renderGit(client, { sessionId: 's1', streaming: true })

  await rerender({ sessionId: 's2', streaming: false })
  expect(request).not.toHaveBeenCalled()
})

test('replace discards an in-flight refresh so a batch load cannot go backwards', async () => {
  let resolveRefresh!: (value: unknown) => void
  const request = jest.fn(() => new Promise((done) => { resolveRefresh = done }))
  const client = { request } as unknown as RelayClient
  const { result } = await renderGit(client, { sessionId: 's1', streaming: false })

  let pending!: Promise<void>
  await act(() => { pending = result.current.refresh('/repo') })
  await act(() => { result.current.replace({ branch: 'feat' }) })
  await act(async () => { resolveRefresh({ branch: 'stale', dirty: { files: 9, insertions: 1, deletions: 0 } }); await pending })
  expect(result.current.gitInfo).toEqual({ branch: 'feat' })
})
