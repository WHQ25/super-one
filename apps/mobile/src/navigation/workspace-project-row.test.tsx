import { expect, test } from '@jest/globals'
import { screen } from '@testing-library/react-native'
import { renderWithTheme } from '../test-render'
import { WorkspaceProjectRow, type WorkspaceProjectRowProps } from './workspace-project-row'
import type { SessionListRow } from '../session-list-state'

const seed: SessionListRow[] = [{ sessionId: 's1', title: 'Fix the drawer' }]
const noop = () => {}
const confirmed = () => Promise.resolve(true)

/** `client: null` is the offline path: the seed is the whole list, no request. */
const row = (overrides: Partial<WorkspaceProjectRowProps> = {}) => (
  <WorkspaceProjectRow
    client={null}
    project={{ path: '/repo', name: 'repo' }}
    expanded={false}
    onToggle={noop}
    seed={seed}
    activeSessionId={null}
    visible
    listRevision={0}
    onOpenSession={noop}
    onPinSession={confirmed}
    onArchiveSession={confirmed}
    onDeleteSession={confirmed}
    {...overrides}
  />
)

test('does not mount a list for a project that has never been expanded', async () => {
  await renderWithTheme(row())
  expect(screen.getByText('repo')).toBeTruthy()
  expect(screen.queryByText('Fix the drawer')).toBeNull()
})

test('shows the sessions once expanded', async () => {
  await renderWithTheme(row({ expanded: true }))
  expect(screen.getByText('Fix the drawer')).toBeTruthy()
})

test('keeps the loaded list mounted across a collapse, so re-expanding costs no request', async () => {
  const { rerender } = await renderWithTheme(row({ expanded: true }))
  expect(screen.getByText('Fix the drawer')).toBeTruthy()

  await rerender(row({ expanded: false }))
  // Hidden, not dropped: `display: 'none'` takes it out of the accessibility
  // tree — so VoiceOver does not read a collapsed project's sessions — while the
  // hook holding the loaded rows stays mounted. Unmounting it is what used to
  // make re-expanding refetch the whole first page.
  expect(screen.queryByText('Fix the drawer')).toBeNull()
  expect(screen.getByText('Fix the drawer', { includeHiddenElements: true })).toBeTruthy()
})
