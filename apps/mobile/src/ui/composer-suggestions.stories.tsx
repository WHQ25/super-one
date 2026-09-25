import { useState, type ComponentProps } from 'react'
import { View } from 'react-native'
import { buildMentionRows } from '../mention-rows'
import { gitRefItems } from '../git-mention'
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

type PreviewProps = Pick<ComponentProps<typeof MentionSuggestions>, 'rows' | 'search' | 'breadcrumbs'> & { width?: number }

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
  rows: buildMentionRows('', { remote: previewRootMentionItems.filter((item) => item.kind === 'dir-entry'), agentProfiles: [] }),
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
