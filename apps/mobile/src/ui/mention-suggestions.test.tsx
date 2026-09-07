import { expect, test } from '@jest/globals'
import { fireEvent, screen } from '@testing-library/react-native'
import { renderWithTheme } from '../test-render'
import type { MentionItem } from '../mentions'
import { buildMentionRows, type MentionRow } from '../mention-rows'
import { MentionSuggestions } from './composer-suggestions'

const file: MentionItem = { kind: 'file', path: 'src/app.ts' }
const agentProfile: MentionItem = { kind: 'agent-profile', path: 'codex-base', label: 'Codex', description: '@codex' }
const projectAgent: MentionItem = { kind: 'agent', path: 'reviewer', label: 'reviewer', description: 'claude-opus-5' }
const desktopApp: MentionItem = { kind: 'desktop-app', path: 'com.apple.Safari', label: 'Safari' }

const row = (item: MentionItem, extra: Partial<MentionRow> = {}): MentionRow =>
  ({ item, labelIndices: [], keywordIndices: [], detail: item.description || item.path, ...extra })

test('orders groups the way the desktop popup does', async () => {
  await renderWithTheme(
    <MentionSuggestions rows={[row(file), row(projectAgent), row(agentProfile)]} onSelect={() => {}} />,
  )
  expect(screen.getAllByRole('header').map((node) => node.props.children))
    .toEqual(['Collaborators', 'Agents', 'Files'])
})

test('keeps collaborators and project agents apart', async () => {
  // A project agent named like a harness is not that harness's collaborator.
  await renderWithTheme(
    <MentionSuggestions rows={[row(agentProfile), row({ kind: 'agent', path: 'codex' })]} onSelect={() => {}} />,
  )
  expect(screen.getByText('Collaborators')).toBeTruthy()
  expect(screen.getByText('Agents')).toBeTruthy()
})

test('falls back to the path basename when an item has no label', async () => {
  await renderWithTheme(
    <MentionSuggestions rows={[row({ kind: 'file', path: 'src/deep/nested.ts' })]} onSelect={() => {}} />,
  )
  expect(screen.getByText('nested.ts')).toBeTruthy()
})

test('passes the whole item to onSelect, not just its path', async () => {
  const selected: MentionItem[] = []
  await renderWithTheme(<MentionSuggestions rows={[row(file)]} onSelect={(item) => selected.push(item)} />)
  fireEvent.press(screen.getByText('app.ts'))
  expect(selected).toEqual([file])
})

test('shows a switched-off capability without letting it be selected', async () => {
  // Filtering it out makes the feature look absent; the user needs to know it
  // exists and is turned off.
  let selections = 0
  const disabled = buildMentionRows('brow', { remote: [], agentProfiles: [], capabilityIds: ['widget'] })
  expect(disabled[0]?.disabled).toBe(true)
  await renderWithTheme(<MentionSuggestions rows={disabled} onSelect={() => { selections += 1 }} />)
  expect(screen.getByText('Turned off on the desktop')).toBeTruthy()
  fireEvent.press(screen.getByText('Super Browser'))
  expect(selections).toBe(0)
})

test('reports an in-flight search while keeping the rows it already has', async () => {
  await renderWithTheme(
    <MentionSuggestions rows={[row(file)]} onSelect={() => {}} search={{ active: true, loading: true }} />,
  )
  expect(screen.getByText('Searching…')).toBeTruthy()
  expect(screen.getByText('app.ts')).toBeTruthy()
})

test('offers a retry when the search failed', async () => {
  let retries = 0
  await renderWithTheme(
    <MentionSuggestions
      rows={[]}
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
    <MentionSuggestions rows={[]} onSelect={() => {}} search={{ active: true, loading: false }} />,
  )
  expect(screen.getByText('No matches')).toBeTruthy()
})

test('stays out of the way when no mention query is open', async () => {
  await renderWithTheme(<MentionSuggestions rows={[]} onSelect={() => {}} />)
  expect(screen.queryByTestId('mention-suggestions')).toBeNull()
})

test('renders a desktop app only once something has been typed', async () => {
  const empty = buildMentionRows('', { remote: [desktopApp], agentProfiles: [] })
  const typed = buildMentionRows('saf', { remote: [desktopApp], agentProfiles: [] })
  expect(empty.some((r) => r.item.kind === 'desktop-app')).toBe(false)
  expect(typed.some((r) => r.item.kind === 'desktop-app')).toBe(true)
})
