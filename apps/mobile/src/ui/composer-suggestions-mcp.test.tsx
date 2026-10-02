import { expect, jest, test } from '@jest/globals'
import { fireEvent, render, screen } from '@testing-library/react-native'
import { MCP_MENTION_SEARCH_IDLE, type McpMentionSearchState, type McpMentionSource } from '@superone/shared/mcp-app-mentions'
import { renderWithTheme } from '../test-render'
import { buildMentionRows } from '../mention-rows'
import { MentionSuggestions } from './composer-suggestions'
import mentionStories, { McpItems } from './composer-suggestions.stories'

const bits = (items: McpMentionSource['items'] = []): McpMentionSource =>
  ({ server: 'bits', tool: 'search_parts', title: 'Bits CAD', items })
const state = (overrides: Partial<McpMentionSearchState>): McpMentionSearchState => ({ ...MCP_MENTION_SEARCH_IDLE, ...overrides })

async function show(mcp: McpMentionSearchState, onSelect = jest.fn()) {
  const rows = buildMentionRows('hex', { remote: [], agentProfiles: [], mcp: mcp.sources })
  await renderWithTheme(<MentionSuggestions rows={rows} mcp={mcp} onSelect={onSelect} search={{ active: true, loading: false }} />)
  return onSelect
}

test('lists a server item under the server and selects it', async () => {
  const onSelect = await show(state({ sources: [bits([{ uri: 'cad://parts/hex-bolt', label: 'Hex bolt' }])] }))
  expect(screen.getByText('Bits CAD')).toBeTruthy()
  await fireEvent.press(screen.getByText('Hex bolt'))
  expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ kind: 'mcp-resource', path: 'bits:cad://parts/hex-bolt' }))
})

test('shows a server still searching instead of "No matches"', async () => {
  await show(state({ sources: [bits()], loading: true }))
  expect(screen.getByText('Bits CAD')).toBeTruthy()
  expect(screen.getByText('Searching…')).toBeTruthy()
  expect(screen.queryByText('No Matches')).toBeNull()
})

test('says which server failed and that others have not answered', async () => {
  await show(state({ sources: [{ ...bits(), failed: true }], incomplete: true }))
  expect(screen.getByText('Search failed')).toBeTruthy()
  expect(screen.getByText("Some MCP servers haven't answered yet")).toBeTruthy()
})

test('stays quiet when the lookup itself failed, as on a desktop too old to search servers', async () => {
  await show(state({ failed: true }))
  expect(screen.queryByText('Search failed')).toBeNull()
  expect(screen.getByText('No Matches')).toBeTruthy()
})

test('the McpItems story selects a part through the production list', async () => {
  const Preview = mentionStories.render
  await render(<Preview {...mentionStories.args} {...McpItems.args} />)
  expect(screen.getByText('Searching…')).toBeTruthy()
  await fireEvent.press(screen.getByText('Hex nut'))
  expect(screen.getByText('mcp-resource: bits:cad://parts/hex-nut')).toBeTruthy()
})
