import { View } from 'react-native'
import { Text } from './text'
import type { TabletSessionRow } from '../navigation/tablet-session-sidebar'
import { useMobileTheme } from '../theme/context'
import { harnessDisplayName } from '../provider-state'
import { HarnessIcon } from './harness-icon'

function relativeTime(value?: string): string {
  if (!value) return ''
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return ''
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60_000))
  if (minutes < 1) return 'Now'
  if (minutes < 60) return `${minutes}m`
  if (minutes < 1_440) return `${Math.floor(minutes / 60)}h`
  if (minutes < 10_080) return `${Math.floor(minutes / 1_440)}d`
  return new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function SessionRowContent({ session, selected }: { session: TabletSessionRow; selected?: boolean }) {
  const { tokens: { colors, radius } } = useMobileTheme()
  const detail = [session.selectedModel && session.selectedModel !== 'default' ? session.selectedModel : harnessDisplayName(session.provider ?? 'claude'), session.gitBranch, session.tags?.slice(0, 2).join(' · ')].filter(Boolean).join(' · ')
  return <View style={{ backgroundColor: selected ? colors.muted : colors.background, borderRadius: radius.md, padding: 12, gap: 6 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <HarnessIcon provider={session.provider ?? 'claude'} acpAgentId={session.acpAgentId} status={session.status} size={18} />
      <Text numberOfLines={1} style={{ flex: 1, color: colors.foreground, fontSize: 15, fontWeight: selected ? '500' : '400' }}>{session.title || 'Untitled'}</Text>
      <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{relativeTime(session.lastActiveAt)}</Text>
    </View>
    <View style={{ paddingLeft: 28, flexDirection: 'row', gap: 8 }}>
      <Text numberOfLines={1} style={{ flex: 1, color: colors.mutedForeground, fontSize: 12 }}>{detail}</Text>
      {session.status === 'streaming' ? <Text style={{ color: colors.primary, fontSize: 12 }}>Working</Text> : null}
    </View>
  </View>
}
