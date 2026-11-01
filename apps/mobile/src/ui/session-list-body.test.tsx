import { expect, test } from '@jest/globals'
import { screen } from '@testing-library/react-native'
import { renderWithTheme } from '../test-render'
import { SessionListBody } from './session-list-body'
import { SESSION_CHILD_LIST_MAX_HEIGHT } from './virtual-session-list'
import type { ProjectSessions } from '../navigation/use-project-sessions'

const noop = () => {}
const confirmed = () => Promise.resolve(true)

function sessions(overrides: Partial<ProjectSessions> = {}): ProjectSessions {
  return {
    items: [], busy: false, loaded: true, loadingMore: false, error: '', hasMore: false, loadedCount: 0,
    loadMore: noop, toggleChildren: noop, forget: noop, patch: noop,
    ...overrides,
  }
}

const body = (state: ProjectSessions) => (
  <SessionListBody
    sessions={state}
    onOpenSession={noop}
    onPinSession={confirmed}
    onSettleSession={confirmed}
    onDeleteSession={confirmed}
  />
)

test('shows nothing before the first read has settled', async () => {
  // `busy` turns on inside an effect, which runs after the first commit — so a
  // list that reads emptiness off `!busy` flashes "No sessions yet" for a frame.
  // The spinner for that read lives on the project row, not in here.
  await renderWithTheme(body(sessions({ loaded: false })))
  expect(screen.queryByText('No sessions yet')).toBeNull()
  expect(JSON.stringify(screen.toJSON())).not.toContain('ActivityIndicator')
})

test('reports an empty project only once the read has settled', async () => {
  await renderWithTheme(body(sessions({ loaded: true })))
  expect(screen.getByText('No Sessions Yet')).toBeTruthy()
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

test('scrolls loaded rows without a Show more control', async () => {
  const items = Array.from({ length: 40 }, (_, index) => ({
    session: { sessionId: `s${index}`, title: `Session ${index}` },
    child: false, hasChildren: false, collapsed: false,
  }))
  await renderWithTheme(body(sessions({ hasMore: true, items })))
  expect(screen.queryByRole('button', { name: 'Show More Sessions' })).toBeNull()
  expect(screen.queryByText('Show More')).toBeNull()
  expect(screen.getByText('Session 0')).toBeTruthy()
  expect(screen.queryByText('Session 39')).toBeNull()
})

test('scrolls an expanded parent\'s children in their own faded list', async () => {
  const children = Array.from({ length: 20 }, (_, index) => ({
    session: { sessionId: `c${index}`, title: `Child ${index}` },
    child: true, hasChildren: false, collapsed: false,
  }))
  await renderWithTheme(body(sessions({
    items: [
      { session: { sessionId: 'p', title: 'Parent' }, child: false, hasChildren: true, collapsed: false },
      ...children,
      { session: { sessionId: 'q', title: 'Next parent' }, child: false, hasChildren: false, collapsed: false },
    ],
  })))
  expect(screen.getByText('Parent')).toBeTruthy()
  expect(screen.getByText('Child 0')).toBeTruthy()
  expect(screen.queryByText('Child 19')).toBeNull()
  expect(screen.getByText('Next parent')).toBeTruthy()
  expect(screen.getByTestId('child-session-list-p').props.style.height).toBe(SESSION_CHILD_LIST_MAX_HEIGHT)
  expect(screen.getByTestId('session-list-fade-bottom')).toBeTruthy()
  expect(screen.queryByTestId('session-list-fade-top')).toBeNull()
})
