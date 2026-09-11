import { expect, jest, test } from '@jest/globals'
import { act, fireEvent, screen } from '@testing-library/react-native'
import { renderWithTheme } from '../test-render'
import { CollabTaskScreen } from './collab-task-screen'

test('asks for the brief when it opens and renders it as markdown', async () => {
  const load = jest.fn<() => Promise<string>>().mockResolvedValue('# Review request\n\nCheck **everything**.')
  await renderWithTheme(<CollabTaskScreen load={load} />)
  expect(load).toHaveBeenCalledTimes(1)
  expect(await screen.findByText('Review request')).toBeTruthy()
})

test('a failed fetch stays on the page with a retry', async () => {
  const load = jest.fn<() => Promise<string>>()
    .mockRejectedValueOnce(new Error('That collaboration request is no longer pending'))
    .mockResolvedValueOnce('Second try.')
  await renderWithTheme(<CollabTaskScreen load={load} />)
  expect(await screen.findByRole('alert')).toHaveTextContent('That collaboration request is no longer pending')
  await act(async () => { fireEvent.press(screen.getByText('Try Again')) })
  expect(await screen.findByText('Second try.')).toBeTruthy()
  expect(load).toHaveBeenCalledTimes(2)
})

test('an empty brief says so instead of showing a blank page', async () => {
  const load = jest.fn<() => Promise<string>>().mockResolvedValue('   ')
  await renderWithTheme(<CollabTaskScreen load={load} />)
  expect(await screen.findByText('This launch has no task brief.')).toBeTruthy()
})
