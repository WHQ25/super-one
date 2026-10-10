import { expect, jest, test } from '@jest/globals'
import { act, renderHook, waitFor } from '@testing-library/react-native'
import { useRef } from 'react'
import type { RelayClient } from '@superone/relay-client'
import { resolveTestProject } from '../project-rpc.test-fixtures'
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
  const rpc = jest.fn(async () => ({ branch: 'main', porcelain: ' M a\n?? b\n?? c', insertions: 10, deletions: 2 }))
  const client = { rpc, resolveProject: resolveTestProject } as unknown as RelayClient
  const { result, rerender } = await renderGit(client, { sessionId: 's1', streaming: true })

  expect(rpc).not.toHaveBeenCalled()
  await rerender({ sessionId: 's1', streaming: false })
  await waitFor(() => expect(result.current.gitInfo?.dirty?.files).toBe(3))
  expect(rpc).toHaveBeenCalledWith('git.status', { projectId: 'p' }, { environmentId: 'desktop' })
  expect(result.current.gitInfo?.dirty?.files).toBe(3)
})

test('refresh is how switching back or opening the git page re-reads the tree', async () => {
  const rpc = jest.fn(async () => ({ branch: 'main', porcelain: ' M a', insertions: 2, deletions: 0 }))
  const client = { rpc, resolveProject: resolveTestProject } as unknown as RelayClient
  const { result } = await renderGit(client, { sessionId: 's1', streaming: false })

  await act(() => result.current.refresh('/repo'))
  expect(rpc).toHaveBeenCalledWith('git.status', { projectId: 'p' }, { environmentId: 'desktop' })
  expect(result.current.gitInfo?.dirty?.files).toBe(1)
})

test('switching sessions does not count as a turn ending', async () => {
  const rpc = jest.fn(async () => ({ branch: 'main' }))
  const client = { rpc, resolveProject: resolveTestProject } as unknown as RelayClient
  const { rerender } = await renderGit(client, { sessionId: 's1', streaming: true })

  await rerender({ sessionId: 's2', streaming: false })
  expect(rpc).not.toHaveBeenCalled()
})

test('replace discards an in-flight refresh so a batch load cannot go backwards', async () => {
  let resolveRefresh!: (value: unknown) => void
  const rpc = jest.fn(() => new Promise((done) => { resolveRefresh = done }))
  const client = { rpc, resolveProject: resolveTestProject } as unknown as RelayClient
  const { result } = await renderGit(client, { sessionId: 's1', streaming: false })

  let pending!: Promise<void>
  await act(async () => { pending = result.current.refresh('/repo'); await Promise.resolve() })
  await act(() => { result.current.replace({ branch: 'feat' }) })
  await act(async () => { resolveRefresh({ branch: 'stale', porcelain: ' M a', insertions: 1, deletions: 0 }); await pending })
  expect(result.current.gitInfo).toEqual({ branch: 'feat' })
})
