import { expect, jest, test } from '@jest/globals'
import { act, renderHook, waitFor } from '@testing-library/react-native'
import type { RemoteCommand } from '@superone/shared/agent-types'
import { useAddProject } from './use-add-project'

/**
 * An unpaired app supplies a `request` that throws where the desktop would
 * answer. The throw is synchronous, so it escapes the hook's mount effect
 * unless the boundary puts it on the promise path.
 */
test('a synchronous request failure does not escape the mount effect', async () => {
  const request = jest.fn((_command: RemoteCommand): Promise<unknown> => {
    throw new Error('Connect to a desktop to browse projects')
  })

  const { result } = await renderHook(() =>
    useAddProject({ request, onAdded: () => {} }))

  await waitFor(() => expect(request).toHaveBeenCalled())
  expect(result.current.step).toEqual({ kind: 'source' })
  expect(result.current.error).toBe('')
})

/**
 * The source step has no field, so nothing can be carried out of it: whichever
 * source is picked starts its own step from scratch.
 */
test('picking a source starts the next step at its own beginning', async () => {
  const request = jest.fn((command: RemoteCommand): Promise<unknown> => Promise.resolve(
    command.type === 'search_github_repos' ? { repos: [] } : { entries: [], path: '/Users/x' },
  ))
  const { result } = await renderHook(() => useAddProject({ request, onAdded: () => {} }))

  await act(async () => { result.current.activate({ key: 'local', icon: 'local', label: 'Local Folder' }) })
  expect(result.current.step).toEqual({ kind: 'browse' })
  expect(result.current.query).toBe('~/')
  expect(result.current.placeholder).toBe('~/Projects/')

  await act(async () => { result.current.goBack() })
  await act(async () => { result.current.activate({ key: 'github', icon: 'github', label: 'GitHub Repository' }) })
  expect(result.current.step).toEqual({ kind: 'repo', source: 'github' })
  expect(result.current.query).toBe('')
})
