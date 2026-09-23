import { useState } from 'react'
import { LogBox, ScrollView, View } from 'react-native'
import { RefreshCw } from 'lucide-react-native'
import { Text } from '../ui/text'
import { useMobileTheme } from '../theme/context'
import { LoadingOverlay } from '../ui/loading-overlay'
import { FilesScreen } from '../screens/files-screen'
import { SessionListBody } from '../ui/session-list-body'
import { McpPanel } from '../ui/mcp-panel'
import { ModelPicker } from '../ui/model-picker'
import { BranchPicker } from '../ui/branch-picker'
import { IconButton } from '../ui/icon-button'
import { TodoPanel } from '../ui/todo-panel'
import type { ProjectSessions } from '../navigation/use-project-sessions'
import type { SessionListRow } from '../session-list-state'
import type { TodoItem } from '@superone/shared/agent-types'
import { PREVIEW_BRANCHES } from './git-fixtures'

/**
 * Every native loading and failure state, in one scroll.
 *
 * Same reason as the session-status gallery: a healthy preview settles in a
 * frame, so the spinner a phone shows over a slow relay, and the error it
 * shows over a dropped one, are exactly the states nobody reviews. Each row
 * mounts the shipping component with the prop (or the slow / rejecting port)
 * that holds it in the state named in the title.
 *
 * Transcript-side states — the two edge loaders, the centred first-paint
 * spinner, the pending-turn line, retry / compacting banners and the
 * session-restore cover — live in the chat WebView and are reachable from the Chat page's
 * **Transcript** selector instead. The file-search spinner is on the
 * `File search` page: `FileFinderView` autofocuses its field, which would
 * scroll this list to it on every mount.
 *
 * `FilesScreen` is itself a `FlatList`. Inside a `FlatList` of sections its
 * empty-state copy never painted and its bounce swallowed the page scroll, so
 * this stays a `ScrollView` with the nested-list warning silenced and those
 * two boxes made touch-transparent — they are here to be looked at.
 */
LogBox.ignoreLogs(['VirtualizedLists should never be nested'])
function Section({ title, note, height, children }: { title: string; note?: string; height?: number; children: React.ReactNode }) {
  const { tokens: { colors, radius } } = useMobileTheme()
  return <View style={{ gap: 6 }}>
    <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: '600' }}>{title}</Text>
    {note ? <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{note}</Text> : null}
    <View style={{ height, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: 'hidden' }}>{children}</View>
  </View>
}

const slow = <T,>(value: T, ms = 2_000) => () => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms))
const failing = (message: string) => () => new Promise<never>((_, reject) => setTimeout(() => reject(new Error(message)), 600))

const row = (sessionId: string, title: string, provider: SessionListRow['provider']): SessionListRow => ({ sessionId, title, provider })
const LIST_ROWS = [row('a', 'Review the mobile interface', 'claude'), row('b', 'Relay ACK buffer GC', 'codex')]
/** `SessionListBody` reads the hook's result; a settled page-one with more behind it is all it needs. */
function projectSessions(overrides: Partial<ProjectSessions>): ProjectSessions {
  return {
    items: LIST_ROWS.map((session) => ({ session, child: false, hasChildren: false, collapsed: false })),
    busy: false, loaded: true, loadingMore: false, error: '', hasMore: true,
    loadMore: () => {}, toggleChildren: () => {}, forget: () => {}, patch: () => {},
    ...overrides,
  }
}
const listActions = {
  onOpenSession: () => {}, onPinSession: async () => false, onArchiveSession: async () => false, onDeleteSession: async () => false,
}

const TODOS: Record<string, TodoItem> = {
  '1': { id: '1', subject: 'Audit every spinner', description: '', status: 'completed' },
  '2': { id: '2', subject: 'Port the todo strip', activeForm: 'Porting the todo strip', description: '', status: 'in_progress' },
  '3': { id: '3', subject: 'Screenshot the gallery', description: '', status: 'pending' },
}

export function LoadingStateGallery() {
  const { tokens: { colors } } = useMobileTheme()
  const [mcp, setMcp] = useState<'loading' | 'error'>('loading')
  const [refreshes, setRefreshes] = useState(0)
  return <ScrollView testID="loading-state-gallery" contentContainerStyle={{ padding: 16, gap: 20, paddingBottom: 48 }}>
    <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
      Real components held in their loading or failed state by a slow or rejecting port. Transcript states are on the Chat page under Transcript.
    </Text>

    <Section title="Terminal · document loading" note="`LoadingOverlay` over the terminal WebView until xterm reports ready." height={140}>
      <LoadingOverlay label="Loading terminal…" />
    </Section>

    <Section title="Files · folder loading" note="Centered spinner with copy; a populated list refreshes through the pull indicator instead." height={200}>
      <View style={{ flex: 1 }} pointerEvents="none">
        <FilesScreen mode={{ kind: 'project', root: '/workspace/super-one', name: 'super-one' }} path="/workspace/super-one/src"
          items={[]} loading onRefresh={() => {}} onOpenDirectory={() => {}} onOpenFile={() => {}} />
      </View>
    </Section>
    <Section title="Files · folder failed" note="Same slot, error tone, with a retry." height={200}>
      <View style={{ flex: 1 }} pointerEvents="none">
        <FilesScreen mode={{ kind: 'project', root: '/workspace/super-one', name: 'super-one' }} path="/workspace/super-one/src"
          items={[]} error="Could not read this folder. Check the desktop connection." onRefresh={() => {}} onOpenDirectory={() => {}} onOpenFile={() => {}} />
      </View>
    </Section>

    <Section title="Session list · more pages behind" note="The quiet 'Show more' footer of a settled page.">
      <SessionListBody {...listActions} sessions={projectSessions({})} surface="page" />
    </Section>
    <Section title="Session list · loading the next page" note="The footer swaps to a spinner; rows on screen stay put.">
      <SessionListBody {...listActions} sessions={projectSessions({ loadingMore: true })} surface="page" />
    </Section>
    <Section title="Session list · read failed" note="The error the hook reports for a page that never came.">
      <SessionListBody {...listActions} sessions={projectSessions({ items: [], hasMore: false, error: 'Could not reach the desktop' })} surface="page" />
    </Section>

    <Section title="MCP panel · reading status / failed" note="Tap the title to flip between the two.">
      <View style={{ padding: 8 }}>
        <McpPanel visible servers={[]} loading={mcp === 'loading'} error={mcp === 'error' ? 'Could not read MCP status' : undefined}
          onDismiss={() => setMcp((value) => value === 'loading' ? 'error' : 'loading')} />
      </View>
    </Section>

    <Section title="Model picker · refreshing" note="Open it and tap the refresh glyph: it spins for 2 s, and with no models the list says 'Loading models…'. The third refresh fails.">
      <View style={{ padding: 12, alignItems: 'flex-start' }}>
        <ModelPicker harness="claude" model="" models={[]} effort="medium" efforts={[]} onModel={() => {}} onEffort={() => {}} compact
          onRefresh={() => { setRefreshes((value) => value + 1); return refreshes >= 2 ? failing('Could not refresh models')() : slow(undefined)() }} />
      </View>
    </Section>

    <Section title="Branch picker · switching" note="Tap a branch: the trailing glyph becomes a spinner until the switch settles (2 s here)." height={220}>
      <BranchPicker branches={PREVIEW_BRANCHES} currentBranch="main" onSwitch={slow(undefined)} onCreate={slow(undefined)} onDone={() => {}} />
    </Section>

    <Section title="Icon button · busy" note="`spinning` on any `IconButton`; used by refresh and reconnect actions.">
      <View style={{ flexDirection: 'row', gap: 12, padding: 8 }}>
        <IconButton icon={RefreshCw} label="Refresh" onPress={() => {}} spinning />
        <IconButton icon={RefreshCw} label="Refresh" onPress={() => {}} spinning chrome="plain" />
        <IconButton icon={RefreshCw} label="Refresh" onPress={() => {}} spinning disabled />
      </View>
    </Section>

    <Section title="Todo strip · running row" note="The in-progress row's dashed ring spins; the strip sits between transcript and composer.">
      <TodoPanel todos={TODOS} />
    </Section>
  </ScrollView>
}
