import { expect, test } from '@jest/globals'
import { fireEvent, screen } from '@testing-library/react-native'
import { renderWithTheme } from '../test-render'
import { directoryNavigationItem, type MentionItem } from '../mentions'
import { buildMentionRows, type MentionRow } from '../mention-rows'
import { MentionSuggestions } from './composer-suggestions'

const file: MentionItem = { kind: 'file', path: 'src/app.ts' }
const agentProfile: MentionItem = { kind: 'agent-profile', path: 'codex-base', label: 'Codex', description: '@codex' }
const projectAgent: MentionItem = { kind: 'agent', path: 'reviewer', label: 'reviewer', description: 'claude-opus-5' }
const desktopApp: MentionItem = { kind: 'desktop-app', path: 'com.apple.Safari', label: 'Safari' }

const row = (item: MentionItem, extra: Partial<MentionRow> = {}): MentionRow =>
  ({ item, label: item.label || item.path, labelIndices: [], inlineIndices: [], ...extra })

test.each([
  ['co', 'computer', '@co'],
  ['se', 'session', '@se'],
  ['co', 'codex-base', '@co'],
  ['dex', 'codex-base', '@'],
])('highlights @ with the matching handle for %s → %s', async (query, path, highlighted) => {
  const rows = buildMentionRows(query, {
    remote: [], agentProfiles: [agentProfile], capabilityIds: ['computer'],
  }).filter((entry) => entry.item.path === path)
  await renderWithTheme(<MentionSuggestions rows={rows} onSelect={() => {}} />)
  expect(screen.getByText(highlighted)).toHaveStyle({ fontWeight: '700' })
  if (query === 'dex') {
    for (const match of screen.getAllByText('dex')) expect(match).toHaveStyle({ fontWeight: '700' })
  }
})

test.each(['', 'Assistant', 'gpt'])('leaves the handle unhighlighted for query %s', async (query) => {
  const rows = buildMentionRows(query, {
    remote: [], agentProfiles: [{ ...agentProfile, label: 'Assistant', aliases: ['gpt'] }],
  }).filter((entry) => entry.item.path === agentProfile.path)
  await renderWithTheme(<MentionSuggestions rows={rows} onSelect={() => {}} />)
  expect(screen.getByText('@codex')).not.toHaveStyle({ fontWeight: '700' })
})

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

test('shows a file as its whole path, not its basename', async () => {
  // Two files called `nested.ts` are indistinguishable otherwise, and the
  // desktop prints the path for exactly that reason.
  await renderWithTheme(
    <MentionSuggestions rows={[row({ kind: 'file', path: 'src/deep/nested.ts' })]} onSelect={() => {}} />,
  )
  expect(screen.getByText('src/deep/nested.ts')).toBeTruthy()
})

test('passes the whole item to onSelect, not just its path', async () => {
  const selected: MentionItem[] = []
  await renderWithTheme(<MentionSuggestions rows={[row(file)]} onSelect={(item) => selected.push(item)} />)
  fireEvent.press(screen.getByText('src/app.ts'))
  expect(selected).toEqual([file])
})

test('shows a switched-off capability without letting it be selected', async () => {
  // Filtering it out makes the feature look absent; the user needs to know it
  // exists and is turned off.
  let selections = 0
  const disabled = buildMentionRows('brow', { remote: [], agentProfiles: [], capabilityIds: ['widget'] })
  expect(disabled[0]?.disabled).toBe(true)
  await renderWithTheme(<MentionSuggestions rows={disabled} onSelect={() => { selections += 1 }} />)
  expect(screen.getByText('Enable Browser CDP in the desktop settings')).toBeTruthy()
  fireEvent.press(screen.getByText('Super Browser'))
  expect(selections).toBe(0)
})

test('reports an in-flight search while keeping the rows it already has', async () => {
  await renderWithTheme(
    <MentionSuggestions rows={[row(file)]} onSelect={() => {}} search={{ active: true, loading: true }} />,
  )
  expect(screen.getByText('Searching…')).toBeTruthy()
  expect(screen.getByText('src/app.ts')).toBeTruthy()
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
  fireEvent.press(screen.getByLabelText('Retry search'))
  expect(retries).toBe(1)
})

/** One scroll event, positioned `fromBottom` px from the end of the list. */
function scrollTo(fromBottom: number) {
  return { nativeEvent: { contentOffset: { y: 1000 - fromBottom }, contentSize: { height: 1256 }, layoutMeasurement: { height: 256 } } }
}

test('fetches the next page on reaching the end of the list', async () => {
  // The desktop loads within 48 px of the bottom (MentionPopup.tsx:400). A
  // tappable row would spend a sixth of the overlay on what scrolling says.
  let loads = 0
  await renderWithTheme(
    <MentionSuggestions rows={[row(file)]} onSelect={() => {}}
      search={{ active: true, loading: false, hasMore: true }} onLoadMore={() => { loads += 1 }} />,
  )
  fireEvent.scroll(screen.getByTestId('mention-list'), scrollTo(10))
  expect(loads).toBe(1)
})

test('leaves the next page alone while the list is far from its end', async () => {
  let loads = 0
  await renderWithTheme(
    <MentionSuggestions rows={[row(file)]} onSelect={() => {}}
      search={{ active: true, loading: false, hasMore: true }} onLoadMore={() => { loads += 1 }} />,
  )
  fireEvent.scroll(screen.getByTestId('mention-list'), scrollTo(400))
  expect(loads).toBe(0)
})

test('does not stack a second fetch on top of the one in flight', async () => {
  // Momentum keeps firing scroll events past the threshold; without the
  // `loading` guard each one starts another page request.
  let loads = 0
  await renderWithTheme(
    <MentionSuggestions rows={[row(file)]} onSelect={() => {}}
      search={{ active: true, loading: true, hasMore: true }} onLoadMore={() => { loads += 1 }} />,
  )
  fireEvent.scroll(screen.getByTestId('mention-list'), scrollTo(10))
  expect(loads).toBe(0)
})

test('says more is coming without spending a row on a button', async () => {
  await renderWithTheme(
    <MentionSuggestions rows={[row(file)]} onSelect={() => {}}
      search={{ active: true, loading: false, hasMore: true }} onLoadMore={() => {}} />,
  )
  expect(screen.getByText('Scroll for more')).toBeTruthy()
  expect(screen.queryByText('Load more')).toBeNull()
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

const directory: MentionItem = { kind: 'dir-entry', path: 'src/ui', isDirectory: true, label: 'ui' }

// Opening a folder and mentioning it are the desktop's Tab and Enter. A tap can
// only carry one of them, so the other needs a target of its own.
test('opens a folder when its row is tapped', async () => {
  const chosen: MentionItem[] = []
  await renderWithTheme(<MentionSuggestions rows={[row(directory)]} onSelect={(item) => chosen.push(item)} />)
  fireEvent.press(screen.getByText('ui'))
  expect(chosen).toEqual([directoryNavigationItem('src/ui', 'ui')])
})

test('mentions the folder itself from a separate target', async () => {
  const chosen: MentionItem[] = []
  await renderWithTheme(<MentionSuggestions rows={[row(directory)]} onSelect={(item) => chosen.push(item)} />)
  fireEvent.press(screen.getByLabelText('Mention ui'))
  expect(chosen).toEqual([{ kind: 'directory', path: 'src/ui', isDirectory: true, label: 'ui' }])
})

test('treats a directory the host returned as a search hit the same way', async () => {
  // Scoped search answers with `kind: 'file'` plus `isDirectory`; a folder found
  // that way still has to be enterable.
  const chosen: MentionItem[] = []
  await renderWithTheme(
    <MentionSuggestions rows={[row({ kind: 'file', path: 'src/ui', isDirectory: true })]} onSelect={(item) => chosen.push(item)} />,
  )
  fireEvent.press(screen.getByText('src/ui'))
  expect(chosen[0]).toEqual(directoryNavigationItem('src/ui'))
})

const trail = [{ label: 'src', query: 'src/' }, { label: 'ui', query: 'src/ui/' }]

test('walks back out of a directory through the breadcrumb trail', async () => {
  const chosen: MentionItem[] = []
  await renderWithTheme(
    <MentionSuggestions rows={[row(file)]} onSelect={(item) => chosen.push(item)} breadcrumbs={trail} />,
  )
  fireEvent.press(screen.getByLabelText('Browse src'))
  expect(chosen).toEqual([directoryNavigationItem('src', 'src')])
})

test('returns to the project root from the trail', async () => {
  const chosen: MentionItem[] = []
  await renderWithTheme(
    <MentionSuggestions rows={[row(file)]} onSelect={(item) => chosen.push(item)} breadcrumbs={trail} />,
  )
  fireEvent.press(screen.getByLabelText('Browse project root'))
  expect(chosen).toEqual([directoryNavigationItem('')])
})

test('does not offer the directory already being listed as somewhere to go', async () => {
  await renderWithTheme(<MentionSuggestions rows={[row(file)]} onSelect={() => {}} breadcrumbs={trail} />)
  expect(screen.queryByLabelText('Browse ui')).toBeNull()
})

test('shows no trail at the project root', async () => {
  await renderWithTheme(<MentionSuggestions rows={[row(file)]} onSelect={() => {}} breadcrumbs={[]} />)
  expect(screen.queryByLabelText('Browse project root')).toBeNull()
})

test('does not print a row\'s own name under itself', async () => {
  // A root-level browse row has nothing above it to name, and repeating the
  // filename as its own second line reads as two different facts.
  await renderWithTheme(
    <MentionSuggestions rows={buildMentionRows('', { remote: [{ kind: 'dir-entry', path: 'apps', isDirectory: true, label: 'apps' }], agentProfiles: [] })}
      onSelect={() => {}} />,
  )
  expect(screen.getAllByText('apps')).toHaveLength(1)
})
