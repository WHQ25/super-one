import { expect, test } from '@jest/globals'
import { act, fireEvent, screen } from '@testing-library/react-native'
import type { Locale, TodoItem } from '@superone/shared/agent-types'
import { renderWithTheme } from '../test-render'
import { TodoPanel } from './todo-panel'

function todo(overrides: Partial<TodoItem> & Pick<TodoItem, 'id'>): TodoItem {
  return { subject: `Todo ${overrides.id}`, description: '', status: 'pending', ...overrides }
}

function map(...items: TodoItem[]): Record<string, TodoItem> {
  return Object.fromEntries(items.map((item) => [item.id, item]))
}

function mount(todos: Record<string, TodoItem>, tablet = false, locale: Locale = 'en') {
  return renderWithTheme(<TodoPanel todos={todos} tablet={tablet} />, 'dark', locale)
}

/**
 * The panel reads the Reduce Motion gate through `useSyncExternalStore`, and
 * React 19 defers a discrete update in a tree that holds one: RNTL's implicit
 * synchronous act around `fireEvent` never flushes the follow-up pass, so a bare
 * press leaves the panel collapsed and every query below it fails.
 */
async function press(element: Parameters<typeof fireEvent.press>[0]) {
  await act(async () => { fireEvent.press(element) })
}

test('renders nothing without todos', async () => {
  await mount({})
  expect(screen.queryByTestId('todo-panel')).toBeNull()
})

test('the collapsed strip reports progress and hides the list', async () => {
  await mount(map(
    todo({ id: '1', status: 'completed' }),
    todo({ id: '2', subject: 'Wire the panel', status: 'in_progress' }),
    todo({ id: '3' }),
  ))
  expect(screen.getByText(/Todos \(1\/3\)/)).toBeTruthy()
  expect(screen.queryByText('#2 Wire the panel')).toBeNull()
})

// Queries below match the whole composed row — `#id` is a nested `<Text>`, and
// RNTL composes a text node with its children rather than matching a substring.
test('expanding shows every row behind its id', async () => {
  await mount(map(
    todo({ id: '1', subject: 'Port the rows' }),
    todo({ id: '2', subject: 'Cap the height' }),
  ))
  await press(screen.getByLabelText('Todos (0/2)'))
  expect(screen.getByText('#1 Port the rows')).toBeTruthy()
  expect(screen.getByText('#2 Cap the height')).toBeTruthy()
})

test('a running row shows its active form and keeps its description open', async () => {
  await mount(map(todo({
    id: '1',
    subject: 'Port the rows',
    activeForm: 'Porting the rows',
    description: 'Reading the Flutter panel',
    status: 'in_progress',
  })))
  await press(screen.getByLabelText('Todos (0/1)'))
  expect(screen.getByText('#1 Porting the rows')).toBeTruthy()
  expect(screen.getByText('Reading the Flutter panel')).toBeTruthy()
})

test('a pending description stays behind the row chevron', async () => {
  await mount(map(todo({ id: '1', subject: 'Cap the height', description: 'Desktop caps at 140' })))
  await press(screen.getByLabelText('Todos (0/1)'))
  expect(screen.queryByText('Desktop caps at 140')).toBeNull()
})

test('pressing an expandable row reveals its description', async () => {
  await mount(map(todo({ id: '1', subject: 'Cap the height', description: 'Desktop caps at 140' })))
  await press(screen.getByLabelText('Todos (0/1)'))
  await press(screen.getByText('#1 Cap the height'))
  expect(screen.getByText('Desktop caps at 140')).toBeTruthy()
})

test('owner and unfinished blockers ride along on the row', async () => {
  await mount(map(
    todo({ id: '1', subject: 'Land the reducer' }),
    todo({ id: '2', subject: 'Ship it', owner: 'codex-worker', blockedBy: ['1'] }),
  ))
  await press(screen.getByLabelText('Todos (0/2)'))
  expect(screen.getByText('codex-worker')).toBeTruthy()
  // Twice: the gate's own row prefix, and the badge on the row it holds up.
  expect(screen.getAllByText('#1')).toHaveLength(2)
})

test('a completed gate stops being a blocker', async () => {
  await mount(map(
    todo({ id: '1', subject: 'Land the reducer', status: 'completed' }),
    todo({ id: '2', subject: 'Ship it', blockedBy: ['1'] }),
  ))
  await press(screen.getByLabelText('Todos (1/2)'))
  expect(screen.getAllByText('#1')).toHaveLength(1)
})

test('translates the header', async () => {
  await mount(map(todo({ id: '1' })), false, 'zh')
  expect(screen.getByText(/待办 \(0\/1\)/)).toBeTruthy()
})

test('a tablet keeps the same rows in the boxed chrome', async () => {
  await mount(map(todo({ id: '1', subject: 'Port the rows' })), true)
  await press(screen.getByLabelText('Todos (0/1)'))
  expect(screen.getByText('#1 Port the rows')).toBeTruthy()
})
