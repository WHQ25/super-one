import { expect, jest, test } from '@jest/globals'
import { fireEvent, screen } from '@testing-library/react-native'
import { StyleSheet } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { renderWithTheme } from '../test-render'
import type { SessionListRow } from '../session-list-state'
import { SessionSearchView } from './session-search-screen'

const INSET_TOP = 59

const row: SessionListRow = {
  sessionId: 'one',
  title: 'Fix search inset',
  projectName: 'super-one',
  provider: 'codex',
}

function page(overrides: Partial<Parameters<typeof SessionSearchView>[0]> = {}) {
  return (
    <SafeAreaProvider initialMetrics={{
      frame: { x: 0, y: 0, width: 390, height: 844 },
      insets: { top: INSET_TOP, left: 0, right: 0, bottom: 34 },
    }}>
      <SessionSearchView
        query=""
        onQuery={() => {}}
        busy={false}
        error=""
        results={[]}
        onOpenSession={() => {}}
        onCancel={() => {}}
        {...overrides}
      />
    </SafeAreaProvider>
  )
}

test('does not pad the notch a second time on top of the shell SafeAreaView', async () => {
  await renderWithTheme(page())
  const style = StyleSheet.flatten(screen.getByTestId('session-search-screen').props.style)
  expect(style.paddingTop ?? 0).toBe(0)
})

test('cancel sits beside the field', async () => {
  const onCancel = jest.fn()
  await renderWithTheme(page({ onCancel }))
  fireEvent.press(screen.getByLabelText('Cancel Search'))
  expect(onCancel).toHaveBeenCalledTimes(1)
})

test('a match opens the session', async () => {
  const onOpenSession = jest.fn()
  await renderWithTheme(page({ query: 'inset', results: [row], onOpenSession }))
  fireEvent.press(screen.getByText('Fix search inset'))
  expect(onOpenSession).toHaveBeenCalledWith(row)
})

test('an empty match names the query', async () => {
  await renderWithTheme(page({ query: 'xyzzy' }))
  expect(screen.getByText('No sessions matched “xyzzy”')).toBeTruthy()
})

test('a failed search shows the host error', async () => {
  await renderWithTheme(page({ query: 'auth', error: 'Search failed' }))
  expect(screen.getByText('Search failed')).toBeTruthy()
})
