import { afterEach, beforeEach, expect, jest, test } from '@jest/globals'
import { act, screen } from '@testing-library/react-native'
import { renderWithTheme } from '../test-render'
import { AnimatedSessionTitle } from './animated-session-title'

jest.mock('./use-icon-motion', () => ({ useIconMotion: () => true }))
beforeEach(() => { jest.useFakeTimers() })
afterEach(() => { jest.useRealTimers() })

const phase = async (value: string) => {
  const onMessage = screen.getByTestId('session-title-animation', { includeHiddenElements: true }).props.onMessage
  await act(async () => { onMessage({ nativeEvent: { data: JSON.stringify({ phase: value }) } }) })
}

test('uses native text at rest and releases the temporary renderer after completion', async () => {
  const view = await renderWithTheme(<AnimatedSessionTitle title="Original" />)
  expect(screen.queryByTestId('session-title-animation', { includeHiddenElements: true })).toBeNull()
  await view.rerender(<AnimatedSessionTitle title="Renamed" />)
  expect(screen.getByText('Original')).toBeTruthy()
  await phase('ready')
  await phase('in')
  await phase('done')
  expect(screen.getByText('Renamed')).toBeTruthy()
  expect(screen.queryByTestId('session-title-animation', { includeHiddenElements: true })).toBeNull()
})

test('ignores stale completion events after a newer rename', async () => {
  const view = await renderWithTheme(<AnimatedSessionTitle title="Original" />)
  await view.rerender(<AnimatedSessionTitle title="Intermediate" />)
  const stale = screen.getByTestId('session-title-animation', { includeHiddenElements: true }).props.onMessage
  await view.rerender(<AnimatedSessionTitle title="Latest" />)
  await act(async () => { stale({ nativeEvent: { data: '{"phase":"done"}' } }) })
  expect(screen.getByTestId('session-title-animation', { includeHiddenElements: true })).toBeTruthy()
  await phase('done')
  expect(screen.getByText('Latest')).toBeTruthy()
})

test('switching session identity cancels its temporary renderer', async () => {
  const view = await renderWithTheme(<AnimatedSessionTitle key="first" title="Original" />)
  await view.rerender(<AnimatedSessionTitle key="first" title="Pending" />)
  await view.rerender(<AnimatedSessionTitle key="second" title="Other session" />)
  expect(screen.getByText('Other session')).toBeTruthy()
  expect(screen.queryByTestId('session-title-animation', { includeHiddenElements: true })).toBeNull()
})

test('falls back to the latest native title if the web renderer cannot load', async () => {
  const view = await renderWithTheme(<AnimatedSessionTitle title="Original" />)
  await view.rerender(<AnimatedSessionTitle title="Renamed" />)
  await act(async () => { jest.advanceTimersByTime(5000) })
  expect(screen.getByText('Renamed')).toBeTruthy()
  expect(screen.queryByTestId('session-title-animation', { includeHiddenElements: true })).toBeNull()
})
