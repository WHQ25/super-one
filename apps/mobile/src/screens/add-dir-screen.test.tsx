import { expect, jest, test } from '@jest/globals'
import { fireEvent, screen } from '@testing-library/react-native'
import { renderWithTheme } from '../test-render'
import { AddDirScreen, type AddDirScreenProps } from './add-dir-screen'

const ENTRIES = [
  { name: 'design-system', path: '/Users/dev/work/design-system' },
  { name: 'docs', path: '/Users/dev/work/docs' },
]

function page(overrides: Partial<AddDirScreenProps> = {}) {
  const props: AddDirScreenProps = {
    step: { kind: 'overview' },
    projectDirs: ['/Users/dev/work/design-system'],
    sessionDirs: [],
    entries: [],
    query: '',
    loading: false,
    busy: false,
    error: '',
    onQuery: () => {},
    onEnter: () => {},
    onBrowse: () => {},
    onRemove: () => {},
    ...overrides,
  }
  return <AddDirScreen {...props} />
}

function browsing(overrides: Partial<AddDirScreenProps> = {}) {
  return page({
    step: { kind: 'browse', scope: 'project' },
    entries: ENTRIES,
    query: '~/work/',
    ...overrides,
  })
}

test('the overview opens on what the session already has, in both scopes', async () => {
  await renderWithTheme(page({ sessionDirs: ['/tmp/scratch'] }))

  expect(screen.getByText('PROJECT')).toBeTruthy()
  expect(screen.getByText('SESSION')).toBeTruthy()
  expect(screen.getByText('/Users/dev/work/design-system')).toBeTruthy()
  expect(screen.getByText('/tmp/scratch')).toBeTruthy()
})

test('an empty scope reads as a fact about it, not as a failure', async () => {
  await renderWithTheme(page())

  expect(screen.getByText('none')).toBeTruthy()
})

test('the overview ends with the scope choice, and each says what it costs', async () => {
  await renderWithTheme(page())

  expect(screen.getByText('Add to')).toBeTruthy()
  expect(screen.getByText(/Every session in this project/i)).toBeTruthy()
  expect(screen.getByText(/Only this session/i)).toBeTruthy()
})

test('picking a scope is what opens the browser', async () => {
  const onBrowse = jest.fn()
  await renderWithTheme(page({ onBrowse }))

  fireEvent.press(screen.getByLabelText('Session'))
  expect(onBrowse).toHaveBeenCalledWith('session')
})

test('removing a folder names the scope it is leaving', async () => {
  const onRemove = jest.fn()
  await renderWithTheme(page({ sessionDirs: ['/tmp/scratch'], onRemove }))

  fireEvent.press(screen.getByLabelText('Remove /tmp/scratch from session'))
  expect(onRemove).toHaveBeenCalledWith('/tmp/scratch', 'session')
})

test('browsing is one field carrying the path, not a second search box', async () => {
  await renderWithTheme(browsing())

  expect(screen.getByDisplayValue('~/work/')).toBeTruthy()
  expect(screen.getByText('Directories')).toBeTruthy()
})

test('tapping a folder appends its segment to whatever prefix is typed', async () => {
  // Appending rather than jumping is what keeps `~/work` from being replaced by
  // its expansion mid-type.
  const onEnter = jest.fn()
  await renderWithTheme(browsing({ onEnter }))

  fireEvent.press(screen.getByLabelText('docs'))
  expect(onEnter).toHaveBeenCalledWith('docs')
})

test('typing in the field is what filters, so the list follows the path', async () => {
  await renderWithTheme(browsing({ query: '~/work/des' }))

  expect(screen.getByLabelText('design-system')).toBeTruthy()
  expect(screen.queryByLabelText('docs')).toBeNull()
})

test('an empty folder says so rather than showing a bare list', async () => {
  await renderWithTheme(browsing({ entries: [] }))

  expect(screen.getByText('No folders here')).toBeTruthy()
})

test('the host refusal is shown, and browsing stays where it was', async () => {
  await renderWithTheme(browsing({ error: 'Already inside this repository — the agent can read it' }))

  expect(screen.getByText('Already inside this repository — the agent can read it')).toBeTruthy()
  expect(screen.getByLabelText('design-system')).toBeTruthy()
})

test('a refusal on the overview is shown there too, where the removal happened', async () => {
  await renderWithTheme(page({ error: 'Could not reach the desktop' }))

  expect(screen.getByText('Could not reach the desktop')).toBeTruthy()
})

test('a write in flight says what it is doing and locks the field', async () => {
  await renderWithTheme(browsing({ busy: true }))

  expect(screen.getByText('Adding folder…')).toBeTruthy()
  expect(screen.getByDisplayValue('~/work/').props.editable).toBe(false)
})
