import { ActivityIndicator, Image, Pressable, ScrollView, View } from 'react-native'
import { Text } from './text'
import type { MentionSearchState } from '../navigation/use-composer-suggestions'
import { Bot, AppWindow, Box, Wrench, X } from 'lucide-react-native'
import { groupItems } from '@superone/shared/popup-groups'
import type { MatchedSlashCommand } from '../slash'
import type { SlashCatalogStatus } from '../slash-catalog'
import { IconButton } from './icon-button'
import type { MentionItem } from '../mentions'
import { useMobileTheme } from '../theme/context'
import { FileTypeIcon } from './file-icon'
import { HarnessIcon } from './harness-icon'
import { brandKeyForAgentRef } from '@superone/shared/agent-mention-tags'
import { mentionGlyphArtwork, mentionGroup } from './mention-glyph-data'

function MatchText({ text, indices = [] }: { text: string; indices?: number[] }) {
  const { tokens: { colors } } = useMobileTheme()
  const matching = new Set(indices)
  const runs: { value: string; matched: boolean }[] = []
  let offset = 0
  for (const char of text) {
    const matched = matching.has(offset)
    const previous = runs.at(-1)
    if (previous?.matched === matched) previous.value += char
    else runs.push({ value: char, matched })
    offset += char.length
  }
  return <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: '500' }}>
    {runs.map((run, index) => <Text key={index} style={run.matched ? { color: colors.primary, fontWeight: '700' } : undefined}>{run.value}</Text>)}
  </Text>
}

function SectionTitle({ title, count }: { title: string; count: number }) {
  const { tokens: { colors } } = useMobileTheme()
  return <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 6, gap: 6 }}>
    <Text accessibilityRole="header" style={{ color: colors.mutedForeground, fontSize: 12 }}>{title}</Text>
    <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>{count}</Text>
  </View>
}

/**
 * The matcher decides which group leads — a skill that outranks every command
 * puts Skills on top. Rendering a fixed Commands-then-Skills order would
 * silently contradict the ranking the highlight indices came from.
 */
function slashGroupOrder(matches: MatchedSlashCommand[]): string[] {
  const order: string[] = []
  for (const match of matches) {
    const key = match.isSkill ? 'skill' : 'command'
    if (!order.includes(key)) order.push(key)
  }
  return order
}

export function SlashSuggestions({ matches, status = 'ready', onSelect, onDismiss }: {
  matches: MatchedSlashCommand[]
  status?: SlashCatalogStatus
  onSelect: (command: string) => void
  onDismiss?: () => void
}) {
  const { tokens: { colors } } = useMobileTheme()
  const groups = groupItems(matches, (match) => (match.isSkill ? 'skill' : 'command'), slashGroupOrder(matches))
  // A catalog still loading has to say so. Rendering nothing is indistinguishable
  // from "this harness has no commands", which is what it used to look like.
  if (!matches.length && status === 'ready') return null
  return <ScrollView testID="slash-suggestions" keyboardShouldPersistTaps="always" style={{ maxHeight: 256, flexGrow: 0, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 12 }} contentContainerStyle={{ padding: 6 }}>
    {onDismiss ? <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
      <IconButton icon={X} label="Hide commands" chrome="plain" iconSize={16} onPress={onDismiss} />
    </View> : null}
    {status === 'loading' ? <View accessibilityLiveRegion="polite" style={{ padding: 8, flexDirection: 'row', gap: 8, alignItems: 'center' }}>
      <ActivityIndicator size="small" color={colors.mutedForeground} />
      <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>Loading commands…</Text>
    </View> : null}
    {status === 'error' && !matches.length ? <Text accessibilityRole="alert" style={{ padding: 8, color: colors.destructive, fontSize: 12 }}>
      Could not load commands
    </Text> : null}
    {groups.map((group) => <View key={group.key}>
      <SectionTitle title={group.key === 'skill' ? 'Skills' : 'Commands'} count={group.items.length} />
      {group.items.map((command) => <Pressable key={`${group.key}:${command.name}`} accessibilityRole="button" onPress={() => onSelect(command.name)}
        style={({ pressed }) => ({ minHeight: 44, gap: 3, paddingHorizontal: 8, paddingVertical: 8, borderRadius: 6, backgroundColor: pressed ? colors.muted : 'transparent' })}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <MatchText text={`/${command.name}`} indices={[0, ...command.matchIndices.map((index) => index + 1)]} />
          {command.argumentHint ? <Text numberOfLines={1} style={{ flex: 1, fontSize: 12, color: colors.mutedForeground }}>{command.argumentHint}</Text> : null}
        </View>
        {command.description ? <Text numberOfLines={2} style={{ color: colors.mutedForeground, fontSize: 12, lineHeight: 17 }}>{command.description}</Text> : null}
      </Pressable>)}
    </View>)}
  </ScrollView>
}

export function MentionIdentity({ item, size = 16 }: { item: MentionItem; size?: number }) {
  const { tokens: { colors, scheme } } = useMobileTheme()
  if (item.iconPng) return <Image accessible={false} resizeMode="contain" source={{ uri: `data:image/png;base64,${item.iconPng}` }} style={{ width: size, height: size, borderRadius: size * 0.22 }} />
  if (item.kind === 'agent-profile') {
    const brand = brandKeyForAgentRef(item.path)
    if (brand === 'acp-grok') return <HarnessIcon provider="acp" acpAgentId="grok" size={size} />
    if (brand === 'acp-opencode') return <HarnessIcon provider="acp" acpAgentId="opencode" size={size} />
    if (brand === 'claude' || brand === 'codex' || brand === 'cursor' || brand === 'opencode' || brand === 'dsh' || brand === 'acp') return <HarnessIcon provider={brand} size={size} />
    return <Bot size={size} color={colors.foreground} />
  }
  if (item.kind === 'agent') {
    const png = mentionGlyphArtwork('agent', scheme, colors.foreground)
    return png ? <Image accessible={false} source={{ uri: `data:image/png;base64,${png}` }} style={{ width: size, height: size }} /> : <Bot size={size} color={colors.foreground} />
  }
  if (mentionGroup(item.kind) === 'Files & folders') return <FileTypeIcon name={item.path} directory={item.isDirectory || item.kind === 'directory'} size={size} />
  const glyphKind = item.kind === 'builtin' ? item.path : item.kind === 'desktop-app' ? 'computer' : item.kind
  const glyph = mentionGlyphArtwork(glyphKind, scheme, colors.foreground)
  if (glyph) return <Image accessible={false} resizeMode="contain" source={{ uri: `data:image/png;base64,${glyph}` }} style={{ width: size, height: size, borderRadius: item.kind === 'miniapp' ? size * 0.22 : 0 }} />
  if (item.kind === 'miniapp') return <Box size={size} color={colors.foreground} />
  if (item.kind === 'desktop-app') return <AppWindow size={size} color={colors.foreground} />
  return <Wrench size={size} color={colors.mutedForeground} />
}

export function MentionSuggestions({ items, onSelect, search, onRetry }: {
  items: MentionItem[]; onSelect: (item: MentionItem) => void
  search?: MentionSearchState; onRetry?: () => void
}) {
  const { tokens: { colors } } = useMobileTheme()
  if (!items.length && !search?.active) return null
  const groups = ['Agents', 'Capabilities', 'Sessions', 'Apps', 'Files & folders', 'Other']
    .map((title) => ({ title, rows: items.filter((item) => mentionGroup(item.kind) === title) }))
  return <ScrollView testID="mention-suggestions" keyboardShouldPersistTaps="always" style={{ maxHeight: 256, flexGrow: 0, borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.surface }} contentContainerStyle={{ padding: 6 }}>
    {groups.filter((group) => group.rows.length).map((group) => <View key={group.title}>
      <SectionTitle title={group.title} count={group.rows.length} />
      {group.rows.map((item) => <Pressable key={`${item.kind}:${item.path}`} accessibilityRole="button" onPress={() => onSelect(item)}
        style={({ pressed }) => ({ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8, borderRadius: 6, backgroundColor: pressed ? colors.muted : 'transparent' })}>
        <MentionIdentity item={item} />
        <View style={{ flex: 1, gap: 3 }}>
          <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 13, fontWeight: '500' }}>{item.label || item.path.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || item.path}</Text>
          <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 12 }}>{item.description || item.path}</Text>
        </View>
      </Pressable>)}
    </View>)}
    {search?.loading ? <View accessibilityLiveRegion="polite" style={{ padding: 8, flexDirection: 'row', gap: 8 }}>
      <ActivityIndicator size="small" color={colors.mutedForeground} />
      <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>Searching…</Text>
    </View> : search?.error ? <View style={{ padding: 8 }}>
      <Text accessibilityRole="alert" style={{ color: colors.destructive, fontSize: 12 }}>{search.error}</Text>
      {onRetry ? <Pressable accessibilityRole="button" onPress={onRetry} style={{ minHeight: 44, justifyContent: 'center' }}>
        <Text style={{ color: colors.primary }}>Retry search</Text>
      </Pressable> : null}
    </View> : !items.length ? <Text accessibilityLiveRegion="polite" style={{ padding: 8, color: colors.mutedForeground, fontSize: 12 }}>No matches</Text> : null}
  </ScrollView>
}
