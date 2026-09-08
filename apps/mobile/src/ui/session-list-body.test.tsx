import { expect, test } from '@jest/globals'
import { screen } from '@testing-library/react-native'
import { renderWithTheme } from '../test-render'
import { SessionListBody } from './session-list-body'
import type { ProjectSessions } from '../navigation/use-project-sessions'

const noop = () => {}
const confirmed = () => Promise.resolve(true)

function sessions(overrides: Partial<ProjectSessions> = {}): ProjectSessions {
  return {
    items: [], busy: false, loaded: true, loadingMore: false, error: '', hasMore: false,
    loadMore: noop, toggleChildren: noop, forget: noop, patch: noop, refresh: noop,
    ...overrides,
  }
}

const body = (state: ProjectSessions) => (
  <SessionListBody
    sessions={state}
    onOpenSession={noop}
    onPinSession={confirmed}
    onArchiveSession={confirmed}
    onDeleteSession={confirmed}
  />
)

test('shows nothing but a spinner before the first read has settled', async () => {
  // `busy` turns on inside an effect, which runs after the first commit — so a
  // list that reads emptiness off `!busy` flashes "No sessions yet" for a frame.
  await renderWithTheme(body(sessions({ loaded: false })))
  expect(screen.queryByText('No sessions yet')).toBeNull()
})

test('reports an empty project only once the read has settled', async () => {
  await renderWithTheme(body(sessions({ loaded: true })))
  expect(screen.getByText('No sessions yet')).toBeTruthy()
})

test('keeps the empty state away while a settled list is being re-read', async () => {
  await renderWithTheme(body(sessions({ loaded: true, busy: true })))
  expect(screen.queryByText('No sessions yet')).toBeNull()
})

test('shows the failure instead of an empty project when the read failed', async () => {
  await renderWithTheme(body(sessions({ loaded: true, error: 'Could not load sessions' })))
  expect(screen.getByText('Could not load sessions')).toBeTruthy()
  expect(screen.queryByText('No sessions yet')).toBeNull()
})
