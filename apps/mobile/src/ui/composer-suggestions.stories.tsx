import { useState, type ComponentProps } from 'react'
import { MCP_MENTION_SEARCH_IDLE, type McpMentionSource } from '@superone/shared/mcp-app-mentions'
import { View } from 'react-native'
import { buildMentionRows } from '../mention-rows'
import { gitKindItems, gitRefItems } from '../git-mention'
import { browseItems } from '../mention-browse'
import {
  previewAgentProfiles, previewCapabilityIds, previewNestedEntries, previewRootMentionItems,
} from '../preview/composer-fixtures'
import { MobileThemeProvider } from '../theme/context'
import { MentionSuggestions } from './composer-suggestions'
import { Text } from './text'

const rootRows = buildMentionRows('', {
  remote: previewRootMentionItems,
  agentProfiles: previewAgentProfiles,
  capabilityIds: previewCapabilityIds,
})

type PreviewProps = Pick<ComponentProps<typeof MentionSuggestions>, 'rows' | 'search' | 'breadcrumbs' | 'mcp'> & { width?: number }

function Preview({ width = 390, ...props }: PreviewProps) {
  const [selection, setSelection] = useState('')
  const [retried, setRetried] = useState(false)
  return <MobileThemeProvider>
    <View style={{ width, maxWidth: '100%', padding: 12, gap: 8 }}>
      <MentionSuggestions {...props}
        rows={retried ? rootRows : props.rows}
        search={retried ? { active: true, loading: false } : props.search}
        onRetry={() => setRetried(true)}
        onSelect={(item) => setSelection(`${item.kind}: ${item.path}`)} />
      {selection ? <Text>{selection}</Text> : null}
    </View>
  </MobileThemeProvider>
}

export default {
  title: 'Mobile/MentionSuggestions',
  component: MentionSuggestions,
  render: Preview,
  args: { rows: rootRows, search: { active: true, loading: false } } satisfies PreviewProps,
}

/** Select Codex or Board to inspect the identity passed to the composer. */
export const BareAt = {}
export const Loading = { args: { rows: [], search: { active: true, loading: true } } }
export const Refreshing = { args: { search: { active: true, loading: true } } }
/** Retry replaces the error with the complete root catalog. */
export const Failed = { args: { rows: [], search: { active: true, loading: false, error: 'Host unavailable' } } }
export const NoInstalledTargets = { args: {
  rows: buildMentionRows('', { remote: previewRootMentionItems.filter((item) => item.kind === 'dir-entry'), agentProfiles: [], capabilityIds: previewCapabilityIds }),
} }
export const NoMatches = { args: { rows: [] } }
export const NarrowLongNames = { args: {
  width: 320,
  rows: buildMentionRows('', {
    agentProfiles: [{ ...previewAgentProfiles[0]!, label: 'Code reviewer for a very long project name' }],
    remote: [{ kind: 'miniapp', path: 'project-board', label: '项目计划与协作看板 — a very long mini-app name' }, ...previewRootMentionItems],
    capabilityIds: previewCapabilityIds,
  }),
} }
export const InsideDirectory = { args: {
  rows: buildMentionRows('', { remote: browseItems(previewNestedEntries, 'src/ui/'), agentProfiles: [], scoped: true }),
  breadcrumbs: [{ label: 'src', query: 'src/' }, { label: 'ui', query: 'src/ui/' }],
} }

/** `@git` on a phone: each kind name stays whole and its `@handle · hint` note is cut at the end. */
export const GitKindsNarrow = { args: {
  width: 320,
  rows: buildMentionRows('', { remote: gitKindItems('git', ''), agentProfiles: [], scoped: true }),
} }

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()
const commitRefs = [
  { kind: 'commit' as const, id: '02d641be0abcdef0123456789', label: '02d641b', detail: 'fix(chat-view): keep deferred read and skill rows collapsed', author: 'Hangqi Wu', date: hoursAgo(1) },
  { kind: 'commit' as const, id: '081f24ca7abcdef0123456789', label: '081f24c', detail: 'feat(device): shape android agent gestures like a finger\'s', author: 'Hangqi Wu', date: hoursAgo(8) },
  { kind: 'commit' as const, id: '0ef70ae85abcdef0123456789', label: '0ef70ae', detail: 'fix(harness): re-probe resource catalogs when the runtime changes', author: 'Hangqi Wu', date: hoursAgo(26) },
]
/** `@git commit`: long subjects keep the first line; sha · author · age sit underneath. */
export const GitCommits = { args: {
  width: 360,
  rows: buildMentionRows('', { remote: gitRefItems(commitRefs, ''), agentProfiles: [], scoped: true }),
} }
/** `@git commit 081`: a sha prefix highlights on the second line. */
export const GitCommitShaMatch = { args: {
  width: 360,
  rows: buildMentionRows('', { remote: gitRefItems(commitRefs, '081'), agentProfiles: [], scoped: true }),
} }

const mcpParts: McpMentionSource = { server: 'bits', tool: 'search_parts', title: 'Bits CAD', items: [
  { uri: 'cad://parts/hex-bolt', label: 'Hex bolt', detail: 'M6 × 30, stainless' },
  { uri: 'cad://parts/hex-nut', label: 'Hex nut', detail: 'M6, nylon insert' },
] }
const mcpDocs: McpMentionSource = { server: 'notion', tool: 'search', title: 'Notion', items: [] }
const mcpRows = (sources: McpMentionSource[], remote = previewRootMentionItems.filter((item) => item.kind === 'dir-entry')) =>
  buildMentionRows('hex', { remote, agentProfiles: [], mcp: sources })
/** `@hex`: Bits CAD answered and sits before Files; Notion is still searching. Select a part to see its value. */
export const McpItems = { args: {
  rows: mcpRows([mcpParts, mcpDocs]),
  mcp: { ...MCP_MENTION_SEARCH_IDLE, sources: [mcpParts, mcpDocs], loading: true },
} }
/** A new `@` before any server answered: the sections the session had last time, searching. */
export const McpSearching = { args: {
  rows: [],
  mcp: { ...MCP_MENTION_SEARCH_IDLE, sources: [{ ...mcpParts, items: [] }, mcpDocs], loading: true },
} }
/** One server failed, one found nothing, and another has not answered at all. */
export const McpFailedAndIncomplete = { args: {
  rows: [],
  mcp: { ...MCP_MENTION_SEARCH_IDLE, sources: [{ ...mcpParts, items: [], failed: true as const }, mcpDocs], incomplete: true },
} }
const mcpLong: McpMentionSource = { ...mcpParts, title: 'Bits CAD — engineering parts library for the factory floor', items: [
  { uri: 'cad://parts/hex-bolt-long', label: 'Hex bolt with a very long catalogue name, grade 8.8', detail: 'M6 × 30, stainless steel, ISO 4017, pack of 100' },
] }
export const McpNarrowLongNames = { args: {
  width: 320, rows: mcpRows([mcpLong], []), mcp: { ...MCP_MENTION_SEARCH_IDLE, sources: [mcpLong] },
} }
