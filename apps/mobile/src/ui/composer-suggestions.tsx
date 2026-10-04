import { Fragment, type ReactNode } from 'react'
import { ActivityIndicator, Image, Pressable, ScrollView, View } from 'react-native'
import { Text } from './text'
import type { MentionSearchState } from '../navigation/use-composer-suggestions'
import { AtSign, Bot, AppWindow, Box, ChevronRight, FolderRoot, FolderTree, Wrench, X } from 'lucide-react-native'
import { groupItems } from '@superone/shared/popup-groups'
import type { MatchedSlashCommand } from '../slash'
import type { SlashCatalogStatus } from '../slash-catalog'
import { IconButton } from './icon-button'
import { directoryMentionItem, directoryNavigationItem, isMentionDirectory, type MentionItem } from '../mentions'
import { parseGitMentionValue } from '../git-mention'
import { groupMentionRows, mentionGroupKey, mentionRowKey, MENTION_GROUP_LABELS, type MentionGroupKey, type MentionRow } from '../mention-rows'
import { useMobileTheme } from '../theme/context'
import { FileTypeIcon } from './file-icon'
import { HarnessIcon } from './harness-icon'
import { brandKeyForAgentRef } from '@superone/shared/agent-mention-tags'
import { mentionGlyphArtwork } from './mention-glyph-data'
import { useMobileLocale } from '../i18n/context'
import { mcpMentionGroupKey, mcpMentionHasStatus, type McpMentionSearchState } from '@superone/shared/mcp-app-mentions'

function MatchRuns({ text, indices = [] }: { text: string; indices?: number[] }) {
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
  return runs.map((run, index) => <Text key={index} style={run.matched ? { color: colors.primary, fontWeight: '700' } : undefined}>{run.value}</Text>)
}

/**
 * `note` is nested in the same line rather than a sibling, as the desktop's
 * single `truncate` span: the line is cut at its end, so the name stays whole
 * and a long note gives way first. Two shrinking siblings would share the
 * shortfall and clip the name instead.
 */
function MatchText({ text, indices, muted, note }: {
  text: string
  indices?: number[]
  muted?: boolean
  note?: { text: string; indices: number[] }
}) {
  const { tokens: { colors } } = useMobileTheme()
  const mutedStyle = { color: colors.mutedForeground, fontSize: 12, fontWeight: '400' } as const
  // `flexShrink` because RN's default is 0: in a row, a long name would
  // otherwise overflow its line and paint over whatever sits beside it.
  return <Text numberOfLines={1} style={muted
    ? { flexShrink: 1, ...mutedStyle }
    : { flexShrink: 1, color: colors.foreground, fontSize: 13, fontWeight: '500' }}>
    <MatchRuns text={text} indices={indices} />
    {note ? <Text style={mutedStyle}>{'  '}<MatchRuns text={note.text} indices={note.indices} /></Text> : null}
  </Text>
}

/** `count` is left out for a section with nothing listed yet. */
function SectionTitle({ title, count, action }: { title: string; count?: number; action?: ReactNode }) {
  const { tokens: { colors } } = useMobileTheme()
  const { t } = useMobileLocale()
  return <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 6, gap: 6 }}>
    <Text accessibilityRole="header" style={{ color: colors.mutedForeground, fontSize: 12 }}>{t(title)}</Text>
    <Text style={{ flex: 1, color: colors.mutedForeground, fontSize: 11 }}>{count ?? ''}</Text>
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
  const { t } = useMobileLocale()
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
      <Text style={{ flex: 1, color: colors.mutedForeground, fontSize: 12 }}>{t('Loading commands…')}</Text>
      {dismiss}
    </View> : null}
    {status === 'error' && !matches.length ? <View style={{ paddingHorizontal: 8, paddingVertical: 6, flexDirection: 'row', gap: 8, alignItems: 'center' }}>
      <Text accessibilityRole="alert" style={{ flex: 1, color: colors.destructive, fontSize: 12 }}>
        {t('Could not load commands')}
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
  // An MCP item is grouped by its server only in a list; on its own it must not read as a file.
  if (item.kind !== 'mcp-resource' && mentionGroupKey(item) === 'file') return <FileTypeIcon name={item.path} directory={item.isDirectory || item.kind === 'directory'} size={size} />
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
    : item.kind === 'git-portal' ? (item.path === 'gh' ? 'github' : 'git:branch')
    : item.kind === 'git-kind' ? `git:${item.path}`
    : item.kind === 'git-ref' ? `git:${parseGitMentionValue(item.path)?.kind ?? 'branch'}`
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
  const { t } = useMobileLocale()
  return <ScrollView horizontal keyboardShouldPersistTaps="always" showsHorizontalScrollIndicator={false}
    style={{ flexGrow: 0, borderBottomWidth: 1, borderBottomColor: colors.border }}
    contentContainerStyle={{ alignItems: 'center', paddingHorizontal: 8, paddingVertical: 6, gap: 2, minHeight: 36 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={t('Browse project root')}
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

/** Server sections without rows — still searching, empty or failed — then the notice, as on the desktop. */
function McpMentionStatus({ state }: { state: McpMentionSearchState }) {
  const { tokens: { colors } } = useMobileTheme()
  const { t } = useMobileLocale()
  const line = (text: string) => <Text style={{ paddingHorizontal: 8, paddingBottom: 6, color: colors.mutedForeground, fontSize: 12 }}>{t(text)}</Text>
  return <>
    {state.sources.filter((source) => !source.items.length).map((source) => <View key={mcpMentionGroupKey(source)}>
      <SectionTitle title={source.title} />
      {line(state.loading ? 'Searching…' : state.failed || source.failed ? 'Search failed' : 'No matches')}
    </View>)}
    {state.incomplete ? line("Some MCP servers haven't answered yet") : null}
  </>
}

export function MentionSuggestions({ rows, onSelect, search, onRetry, onLoadMore, breadcrumbs, groupLabels, mcp }: {
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
  /** The session's MCP servers; their items are already in `rows`. */
  mcp?: McpMentionSearchState
}) {
  const { tokens: { colors } } = useMobileTheme()
  const { t } = useMobileLocale()
  // A lookup that failed outright says nothing a user can act on: on a desktop too old
  // to search servers it would fail on every `@`. The desktop's "Couldn't reach MCP
  // servers" line is left out for that reason.
  const mcpStatus = mcp && !(mcp.failed && !mcp.sources.length) && mcpMentionHasStatus(mcp) ? <McpMentionStatus state={mcp} /> : null
  if (!rows.length && !search?.active && !mcpStatus) return null
  // Status-only server sections take their place in the order, before files.
  const groups = groupMentionRows(rows)
  const fileGroupIndex = groups.findIndex((group) => group.key === 'file')
  // A server's section is titled by the server, as on the desktop.
  const groupTitle = (key: string) => groupLabels?.[key]
    ?? mcp?.sources.find((source) => mcpMentionGroupKey(source) === key)?.title
    ?? MENTION_GROUP_LABELS[key as MentionGroupKey]
  return <View testID="mention-suggestions" style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.surface, overflow: 'hidden' }}>
    {breadcrumbs?.length ? <MentionBreadcrumbs trail={breadcrumbs} onSelect={onSelect} /> : null}
    <ScrollView testID="mention-list" keyboardShouldPersistTaps="always" style={{ maxHeight: 256, flexGrow: 0 }} contentContainerStyle={{ padding: 6 }}
      // The next page arrives by scrolling, as on the desktop
      // (`MentionPopup.tsx:400`), rather than by tapping a 44 pt row inside a
      // 256 px list. `loading` is the guard: momentum fires this many times.
      scrollEventThrottle={16}
      onScroll={({ nativeEvent: { contentOffset, contentSize, layoutMeasurement } }) => {
        if (!search?.hasMore || search.loading || !onLoadMore) return
        if (contentSize.height - contentOffset.y - layoutMeasurement.height < 48) onLoadMore()
      }}>
      {groups.map((group, groupIndex) => <Fragment key={group.key}>
        {groupIndex === fileGroupIndex ? mcpStatus : null}
        <View>
        <SectionTitle title={groupTitle(group.key)} count={group.items.length} />
        {group.items.map((row) => {
          const { item, label, labelIndices, inline, inlineIndices, trailing, badge, hint, hintIndices, disabled } = row
          // Match desktop handles: include the typed @ only when the keyword
          // matched, leaving display-name-only and alias matches unhighlighted.
          const inlineMatchIndices = inline?.startsWith('@') && inlineIndices.length > 0
            ? [0, ...inlineIndices.map((index) => index + 1)]
            : inlineIndices
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
                  capability or a commit adds a second line. */}
              <View style={{ flex: 1, gap: 2 }}>
                <MatchText text={label} indices={labelIndices}
                  note={inline ? { text: inline, indices: inlineMatchIndices } : undefined} />
                {hint ? <MatchText text={hint} indices={hintIndices} muted /> : null}
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
        </View>
      </Fragment>)}
      {fileGroupIndex < 0 ? mcpStatus : null}
      {search?.loading ? <View accessibilityLiveRegion="polite" style={{ padding: 8, flexDirection: 'row', gap: 8 }}>
        <ActivityIndicator size="small" color={colors.mutedForeground} />
        <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{t('Searching…')}</Text>
      </View> : search?.error ? <View style={{ paddingHorizontal: 8, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {/* Retry sits beside the message rather than under it. The desktop has
            no retry at all — it is here because the relay can drop — but that
            is no reason to spend two rows saying one thing. */}
        <Text accessibilityRole="alert" style={{ flex: 1, color: colors.destructive, fontSize: 12 }}>{search.error}</Text>
        {onRetry ? <Pressable accessibilityRole="button" accessibilityLabel={t('Retry search')} onPress={onRetry} hitSlop={10}
          style={({ pressed }) => ({ paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6, backgroundColor: pressed ? colors.muted : 'transparent' })}>
          <Text style={{ color: colors.primary, fontSize: 12 }}>{t('Retry')}</Text>
        </Pressable> : null}
      </View> : !rows.length && !mcpStatus ? <Text accessibilityLiveRegion="polite" style={{ padding: 8, color: colors.mutedForeground, fontSize: 12 }}>
        {/* What "nothing" means depends on what was asked: no projects match,
            no recent sessions, or no matches at all. */}
        {t(search?.emptyLabel ?? 'No matches')}
      </Text> : search?.hasMore ? <Text style={{ paddingHorizontal: 8, paddingVertical: 4, color: colors.mutedForeground, fontSize: 11 }}>
        {t('Scroll for more')}
      </Text> : null}
    </ScrollView>
  </View>
}

/**
 * The follow-ups a harness offers at the end of a turn.
 *
 * Desktop puts the first one in the composer as ghost text and accepts it with Tab;
 * there is no Tab here, so every suggestion — including the first — is a row the
 * user taps. A tap fills the composer rather than sending, so it stays editable.
 *
 * Same card as the slash and mention lists, not a strip of chips: between the
 * status row and the action bar a 32 pt chip read as a stray, while a full-width
 * panel is the shape everything else in that slot already takes. It answers no
 * keystroke — it shows while the draft is empty and leaves once there is one.
 */
export function PromptSuggestions({ suggestions, onSelect, onDismiss }: {
  suggestions: string[]
  onSelect: (suggestion: string) => void
  onDismiss?: () => void
}) {
  const { tokens: { colors } } = useMobileTheme()
  if (!suggestions.length) return null
  // Same 28 pt dismiss on the title row as the command list, for the same reason.
  const dismiss = onDismiss ? <IconButton icon={X} label="Hide suggestions" chrome="plain" iconSize={16}
    style={{ width: 28, height: 28 }} hitSlop={8} onPress={onDismiss} /> : null
  return <ScrollView testID="prompt-suggestions" keyboardShouldPersistTaps="always"
    style={{ maxHeight: 256, flexGrow: 0, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 12 }}
    contentContainerStyle={{ padding: 6 }}>
    <SectionTitle title="Suggestions" count={suggestions.length} action={dismiss} />
    {suggestions.map((suggestion) => <Pressable key={suggestion} accessibilityRole="button" accessibilityLabel={suggestion}
      onPress={() => onSelect(suggestion)}
      style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', paddingHorizontal: 8, paddingVertical: 8, borderRadius: 6, backgroundColor: pressed ? colors.muted : 'transparent' })}>
      <Text numberOfLines={2} style={{ color: colors.foreground, fontSize: 13, lineHeight: 18 }}>{suggestion}</Text>
    </Pressable>)}
  </ScrollView>
}
