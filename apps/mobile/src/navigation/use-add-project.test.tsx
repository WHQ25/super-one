import { expect, jest, test } from '@jest/globals'
import { renderHook, waitFor } from '@testing-library/react-native'
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
