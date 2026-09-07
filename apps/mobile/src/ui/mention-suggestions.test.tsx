import { expect, test } from '@jest/globals'
import { fireEvent, screen } from '@testing-library/react-native'
import { renderWithTheme } from '../test-render'
import type { MentionItem } from '../mentions'
import { MentionSuggestions } from './composer-suggestions'

const file: MentionItem = { kind: 'file', path: 'src/app.ts', label: 'app.ts', description: 'src/app.ts' }
const agent: MentionItem = { kind: 'agent-profile', path: 'codex-base', label: 'Codex', description: '@codex' }
const capability: MentionItem = { kind: 'builtin', path: 'debug', label: 'Debug', description: 'Inspect state' }

test('orders groups and labels each with its row count', async () => {
  await renderWithTheme(<MentionSuggestions items={[file, agent, capability]} onSelect={() => {}} />)
  // Agents before Capabilities before Files & folders, per `mentionGroup`.
  expect(screen.getByText('Agents')).toBeTruthy()
  expect(screen.getByText('Capabilities')).toBeTruthy()
  expect(screen.getByText('Files & folders')).toBeTruthy()
  expect(screen.getAllByText('1')).toHaveLength(3)
})

test('falls back to the path basename when an item has no label', async () => {
  await renderWithTheme(
    <MentionSuggestions items={[{ kind: 'file', path: 'src/deep/nested.ts' }]} onSelect={() => {}} />,
  )
  expect(screen.getByText('nested.ts')).toBeTruthy()
})

test('passes the whole item to onSelect, not just its path', async () => {
  const selected: MentionItem[] = []
  await renderWithTheme(<MentionSuggestions items={[file]} onSelect={(item) => selected.push(item)} />)
  fireEvent.press(screen.getByText('app.ts'))
  expect(selected).toEqual([file])
})

test('reports an in-flight search while keeping the rows it already has', async () => {
  await renderWithTheme(
    <MentionSuggestions items={[file]} onSelect={() => {}} search={{ active: true, loading: true }} />,
  )
  expect(screen.getByText('Searching…')).toBeTruthy()
  expect(screen.getByText('app.ts')).toBeTruthy()
})

test('offers a retry when the search failed', async () => {
  let retries = 0
  await renderWithTheme(
    <MentionSuggestions
      items={[]}
      onSelect={() => {}}
      search={{ active: true, loading: false, error: 'Host unreachable' }}
      onRetry={() => { retries += 1 }}
    />,
  )
  expect(screen.getByText('Host unreachable')).toBeTruthy()
  fireEvent.press(screen.getByText('Retry search'))
  expect(retries).toBe(1)
})

test('says there are no matches only once a search has settled', async () => {
  await renderWithTheme(
    <MentionSuggestions items={[]} onSelect={() => {}} search={{ active: true, loading: false }} />,
  )
  expect(screen.getByText('No matches')).toBeTruthy()
})

test('stays out of the way when no mention query is open', async () => {
  await renderWithTheme(<MentionSuggestions items={[]} onSelect={() => {}} />)
  expect(screen.queryByTestId('mention-suggestions')).toBeNull()
})
