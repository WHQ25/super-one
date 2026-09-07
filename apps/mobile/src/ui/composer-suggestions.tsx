import type { ReactNode } from 'react'
import { ActivityIndicator, Image, Pressable, ScrollView, View } from 'react-native'
import { Text } from './text'
import type { MentionSearchState } from '../navigation/use-composer-suggestions'
import { AtSign, Bot, AppWindow, Box, ChevronRight, FolderRoot, FolderTree, Wrench, X } from 'lucide-react-native'
import { groupItems } from '@superone/shared/popup-groups'
import type { MatchedSlashCommand } from '../slash'
import type { SlashCatalogStatus } from '../slash-catalog'
import { IconButton } from './icon-button'
import { directoryMentionItem, directoryNavigationItem, isMentionDirectory, type MentionItem } from '../mentions'
import { groupMentionRows, mentionGroupKey, mentionRowKey, MENTION_GROUP_LABELS, type MentionGroupKey, type MentionRow } from '../mention-rows'
import { useMobileTheme } from '../theme/context'
import { FileTypeIcon } from './file-icon'
import { HarnessIcon } from './harness-icon'
import { brandKeyForAgentRef } from '@superone/shared/agent-mention-tags'
import { mentionGlyphArtwork } from './mention-glyph-data'

function MatchText({ text, indices = [], muted }: { text: string; indices?: number[]; muted?: boolean }) {
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
  return <Text numberOfLines={1} style={muted
    ? { color: colors.mutedForeground, fontSize: 12 }
    : { color: colors.foreground, fontSize: 13, fontWeight: '500' }}>
    {runs.map((run, index) => <Text key={index} style={run.matched ? { color: colors.primary, fontWeight: '700' } : undefined}>{run.value}</Text>)}
  </Text>
}

function SectionTitle({ title, count, action }: { title: string; count: number; action?: ReactNode }) {
  const { tokens: { colors } } = useMobileTheme()
  return <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 6, gap: 6 }}>
    <Text accessibilityRole="header" style={{ color: colors.mutedForeground, fontSize: 12 }}>{title}</Text>
    <Text style={{ flex: 1, color: colors.mutedForeground, fontSize: 11 }}>{count}</Text>
    {action}
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
  /**
   * Dismiss rides the first row rather than taking one of its own.
   *
   * A 44 pt button on its own line spent a sixth of a 256 px overlay on a
   * control the desktop does not even have — there, Escape closes the popup.
   * Drawn at 28 pt with `hitSlop`, it costs no height at all and still answers
   * a finger at 44.
   */
  const dismiss = onDismiss ? <IconButton icon={X} label="Hide commands" chrome="plain" iconSize={16}
    style={{ width: 28, height: 28 }} hitSlop={8} onPress={onDismiss} /> : null
  // Whichever row renders first carries it; the status rows precede the groups.
  const statusRow = status === 'loading' || (status === 'error' && !matches.length)
  return <ScrollView testID="slash-suggestions" keyboardShouldPersistTaps="always" style={{ maxHeight: 256, flexGrow: 0, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 12 }} contentContainerStyle={{ padding: 6 }}>
    {status === 'loading' ? <View accessibilityLiveRegion="polite" style={{ paddingHorizontal: 8, paddingVertical: 6, flexDirection: 'row', gap: 8, alignItems: 'center' }}>
      <ActivityIndicator size="small" color={colors.mutedForeground} />
      <Text style={{ flex: 1, color: colors.mutedForeground, fontSize: 12 }}>Loading commands…</Text>
      {dismiss}
    </View> : null}
    {status === 'error' && !matches.length ? <View style={{ paddingHorizontal: 8, paddingVertical: 6, flexDirection: 'row', gap: 8, alignItems: 'center' }}>
      <Text accessibilityRole="alert" style={{ flex: 1, color: colors.destructive, fontSize: 12 }}>
        Could not load commands
      </Text>
      {dismiss}
    </View> : null}
    {groups.map((group, index) => <View key={group.key}>
      <SectionTitle title={group.key === 'skill' ? 'Skills' : 'Commands'} count={group.items.length}
        action={!statusRow && index === 0 ? dismiss : undefined} />
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
  if (mentionGroupKey(item) === 'file') return <FileTypeIcon name={item.path} directory={item.isDirectory || item.kind === 'directory'} size={size} />
  // The portal is a way into the session archive and a scope row is a folder,
  // so they borrow those glyphs rather than falling through to the generic one.
  // `all` gets the stacked-folders glyph the desktop gives it, because it is
  // every project rather than one.
  if (item.kind === 'session-project') {
    return item.navigateTo === 'session all '
      ? <FolderTree size={size} color={colors.foreground} />
      : <FileTypeIcon name={item.path} directory size={size} />
  }
  const glyphKind = item.kind === 'builtin' ? item.path
    : item.kind === 'desktop-app' ? 'computer'
    : item.kind === 'session-portal' ? 'session'
    : item.kind
  const glyph = mentionGlyphArtwork(glyphKind, scheme, colors.foreground)
  if (glyph) return <Image accessible={false} resizeMode="contain" source={{ uri: `data:image/png;base64,${glyph}` }} style={{ width: size, height: size, borderRadius: item.kind === 'miniapp' ? size * 0.22 : 0 }} />
  if (item.kind === 'miniapp') return <Box size={size} color={colors.foreground} />
  if (item.kind === 'desktop-app') return <AppWindow size={size} color={colors.foreground} />
  return <Wrench size={size} color={colors.mutedForeground} />
}

/**
 * Where in the project the open `@` query is pointing, and the way back out.
 *
 * The desktop walks directories with Tab and Backspace. A phone has neither, so
 * without this the only way out of `@src/ui/` is to delete the path by hand.
 */
function MentionBreadcrumbs({ trail, onSelect }: {
  trail: { label: string; query: string }[]
  onSelect: (item: MentionItem) => void
}) {
  const { tokens: { colors } } = useMobileTheme()
  return <ScrollView horizontal keyboardShouldPersistTaps="always" showsHorizontalScrollIndicator={false}
    style={{ flexGrow: 0, borderBottomWidth: 1, borderBottomColor: colors.border }}
    contentContainerStyle={{ alignItems: 'center', paddingHorizontal: 8, paddingVertical: 6, gap: 2, minHeight: 36 }}>
    <Pressable accessibilityRole="button" accessibilityLabel="Browse project root"
      onPress={() => onSelect(directoryNavigationItem(''))}
      style={({ pressed }) => ({ padding: 4, borderRadius: 6, backgroundColor: pressed ? colors.muted : 'transparent' })}>
      <FolderRoot size={14} color={colors.mutedForeground} />
    </Pressable>
    {trail.map((crumb, index) => {
      // The last crumb is the directory already being listed; making it look
      // tappable would promise a move that goes nowhere.
      const current = index === trail.length - 1
      return <View key={crumb.query} style={{ flexDirection: 'row', alignItems: 'center' }}>
        <ChevronRight size={12} color={colors.mutedForeground} />
        <Pressable accessibilityRole={current ? 'text' : 'button'} disabled={current}
          accessibilityLabel={current ? undefined : `Browse ${crumb.label}`}
          onPress={() => onSelect(directoryNavigationItem(crumb.query.replace(/\/$/, ''), crumb.label))}
          style={({ pressed }) => ({ paddingHorizontal: 4, paddingVertical: 2, borderRadius: 6, backgroundColor: pressed ? colors.muted : 'transparent' })}>
          <Text style={{ fontSize: 12, color: current ? colors.foreground : colors.mutedForeground, fontWeight: current ? '600' : '400' }}>{crumb.label}</Text>
        </Pressable>
      </View>
    })}
  </ScrollView>
}

export function MentionSuggestions({ rows, onSelect, search, onRetry, onLoadMore, breadcrumbs, groupLabels }: {
  rows: MentionRow[]
  /** Per-group overrides; the sessions group is *Recent* before a title query. */
  groupLabels?: Partial<Record<string, string>>
  onSelect: (item: MentionItem) => void
  search?: MentionSearchState
  onRetry?: () => void
  /** Fetch the next page; only offered while `search.hasMore`. */
  onLoadMore?: () => void
  /** Directory trail of the open query; empty at the project root. */
  breadcrumbs?: { label: string; query: string }[]
}) {
  const { tokens: { colors } } = useMobileTheme()
  if (!rows.length && !search?.active) return null
  return <View testID="mention-suggestions" style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.surface, overflow: 'hidden' }}>
    {breadcrumbs?.length ? <MentionBreadcrumbs trail={breadcrumbs} onSelect={onSelect} /> : null}
    <ScrollView keyboardShouldPersistTaps="always" style={{ maxHeight: 256, flexGrow: 0 }} contentContainerStyle={{ padding: 6 }}>
      {groupMentionRows(rows).map((group) => <View key={group.key}>
        <SectionTitle title={groupLabels?.[group.key] ?? MENTION_GROUP_LABELS[group.key as MentionGroupKey]} count={group.items.length} />
        {group.items.map((row) => {
          const { item, label, labelIndices, inline, inlineIndices, trailing, badge, hint, disabled } = row
          // Tapping a folder opens it — the desktop's Tab. Mentioning the folder
          // itself is the desktop's Enter, and needs its own target here.
          const directory = isMentionDirectory(item)
          return <View key={mentionRowKey(item)} style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !!disabled }}
              // A capability the desktop has switched off stays listed so the user
              // learns it exists, but selecting it would insert a tag nothing answers.
              disabled={disabled}
              onPress={() => onSelect(directory ? directoryNavigationItem(item.path, item.label) : item)}
              style={({ pressed }) => ({ flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 6, opacity: disabled ? 0.45 : 1, backgroundColor: pressed ? colors.muted : 'transparent' })}>
              <MentionIdentity item={item} />
              {/* One line, as on the desktop: name, a quiet note beside it, and
                  what distinguishes it pushed to the end. Only a switched-off
                  capability adds a second line. */}
              <View style={{ flex: 1, gap: 2 }}>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
                  <MatchText text={label} indices={labelIndices} />
                  {inline ? <MatchText text={inline} indices={inline.startsWith('@') ? inlineIndices.map((index) => index + 1) : inlineIndices} muted /> : null}
                </View>
                {hint ? <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 12 }}>{hint}</Text> : null}
              </View>
              {trailing ? <Text numberOfLines={1} style={{ maxWidth: 96, color: colors.mutedForeground, fontSize: 11 }}>{trailing}</Text> : null}
              {badge ? <Text numberOfLines={1} style={{ fontSize: 11, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4,
                color: badge.tone === 'accent' ? colors.success : colors.mutedForeground,
                backgroundColor: badge.tone === 'accent' ? `${colors.success}1f` : colors.muted }}>{badge.text}</Text> : null}
            </Pressable>
            {directory ? <IconButton icon={AtSign} label={`Mention ${label}`} chrome="plain" iconSize={15}
              onPress={() => onSelect(directoryMentionItem(item))} /> : null}
          </View>
        })}
      </View>)}
      {search?.loading ? <View accessibilityLiveRegion="polite" style={{ padding: 8, flexDirection: 'row', gap: 8 }}>
        <ActivityIndicator size="small" color={colors.mutedForeground} />
        <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>Searching…</Text>
      </View> : search?.error ? <View style={{ padding: 8 }}>
        <Text accessibilityRole="alert" style={{ color: colors.destructive, fontSize: 12 }}>{search.error}</Text>
        {onRetry ? <Pressable accessibilityRole="button" onPress={onRetry} style={{ minHeight: 44, justifyContent: 'center' }}>
          <Text style={{ color: colors.primary }}>Retry search</Text>
        </Pressable> : null}
      </View> : !rows.length ? <Text accessibilityLiveRegion="polite" style={{ padding: 8, color: colors.mutedForeground, fontSize: 12 }}>
        {/* What "nothing" means depends on what was asked: no projects match,
            no recent sessions, or no matches at all. */}
        {search?.emptyLabel ?? 'No matches'}
      </Text> : search?.hasMore && onLoadMore ? <Pressable accessibilityRole="button" onPress={onLoadMore}
        style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', paddingHorizontal: 8, borderRadius: 6, backgroundColor: pressed ? colors.muted : 'transparent' })}>
        <Text style={{ color: colors.primary, fontSize: 13 }}>Load more</Text>
      </Pressable> : null}
    </ScrollView>
  </View>
}
