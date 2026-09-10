import { useState, type ComponentProps } from 'react'
import { View } from 'react-native'
import { buildMentionRows } from '../mention-rows'
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
