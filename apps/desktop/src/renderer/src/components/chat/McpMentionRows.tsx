/**
 * Mention popup rows for MCP servers that declare `mentions/search`: one item
 * row per result, and the per-server status lines (searching, no matches,
 * failed) plus the "some servers have not answered" notice.
 */
import { useTranslation } from 'react-i18next'
import { cn } from '@superone/ui/lib/utils'
import { mcpResourceMentionIcon } from '@superone/ui/components/ui/mention-icons'
import { HighlightedText } from '@superone/ui/components/ui/HighlightedText'
import { parseMcpMentionValue, type McpMentionItem, type McpMentionSource } from '@superone/shared/mcp-app-mentions'
import type { McpMentionSearchState } from '@/components/mcp-apps/mention-search'
import { useMcpMentionIcon } from '@/components/mcp-apps/mention-icons'
import { McpAppIcon } from '@/components/mcp-apps/McpAppIcon'
import { useMcpServerIcon } from './use-mcp-server-icon'
import { PopupSectionHeader } from './popup-groups'
import { STACKED_BODY_CLASS, STACKED_DETAIL_CLASS, STACKED_ICON_CLASS, STACKED_ROW_CLASS, mentionRowClass } from './mention-row-layout'

export interface McpMentionFlatItem {
  kind: 'mcp-resource'
  server: string
  tool: string
  title: string
  sourceIcon?: string
  item: McpMentionItem
  /** Where the query occurs in the label / detail; the server matched however it likes. */
  matchIndices: number[]
  detailMatchIndices: number[]
}

export const mcpMentionGroupKey = (source: Pick<McpMentionSource, 'server' | 'tool'>) => `mcp:${source.server}/${source.tool}`

export function mcpMentionFlatItems(sources: McpMentionSource[], match: (text: string) => number[] | null): McpMentionFlatItem[] {
  return sources.flatMap(({ server, tool, title, icon, items }) =>
    items.map(item => ({
      kind: 'mcp-resource' as const, server, tool, title, ...(icon ? { sourceIcon: icon } : {}), item,
      matchIndices: match(item.label) ?? [],
      detailMatchIndices: item.detail ? match(item.detail) ?? [] : [],
    })))
}

/**
 * The icon a server is shown with: what its search answers carried, else the icon
 * SuperOne already knows for that server (tool rows use the same), else none.
 */
function useMcpMentionServerIcon(server: string | undefined): string | undefined {
  const declared = useMcpMentionIcon(server)
  const known = useMcpServerIcon(server)
  return declared ?? known
}

/** The chip's leading icon, else the MCP mark. `.mention-chip__icon` sizes it. */
export function McpMentionChipIcon({ value }: { value: string }) {
  const icon = useMcpMentionServerIcon(parseMcpMentionValue(value)?.server)
  return <McpAppIcon src={icon} fallback={mcpResourceMentionIcon()} />
}

/** Something the popup must stay open for even with no selectable rows. */
export function mcpMentionHasStatus(state: McpMentionSearchState): boolean {
  return state.failed || state.incomplete || state.sources.some(source => source.failed || (state.loading && !source.items.length))
}

/** A row's icon: the item's own, else its server's. */
function McpIcon({ src, server, className }: { src?: string; server: string; className?: string }) {
  const serverIcon = useMcpMentionServerIcon(server)
  return (
    <McpAppIcon
      src={src ?? serverIcon}
      className={cn('size-3.5 shrink-0', className)}
      fallback={<span className={cn('flex size-3.5 shrink-0 [&>svg]:size-3.5', className)}>{mcpResourceMentionIcon('text-muted-foreground')}</span>}
    />
  )
}

export function McpMentionRow({ entry, selected, setItemRef, onHover, onSelect }: {
  entry: McpMentionFlatItem
  selected: boolean
  setItemRef: (el: HTMLButtonElement | null) => void
  onHover: () => void
  onSelect: () => void
}) {
  const { item } = entry
  return (
    <button
      ref={setItemRef}
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onSelect}
      onMouseEnter={onHover}
      className={cn(mentionRowClass(selected), item.detail && STACKED_ROW_CLASS)}
      title={item.uri}
    >
      <McpIcon src={item.icon ?? entry.sourceIcon} server={entry.server} className={item.detail ? STACKED_ICON_CLASS : undefined} />
      <span className={STACKED_BODY_CLASS}>
        <span className="min-w-0 truncate font-medium @md:flex-1">
          <HighlightedText text={item.label} indices={entry.matchIndices} className="truncate" />
        </span>
        {item.detail ? (
          <span className={cn(STACKED_DETAIL_CLASS, '@md:max-w-[50%] @md:shrink-0')}>
            <HighlightedText text={item.detail} indices={entry.detailMatchIndices} className="truncate" />
          </span>
        ) : null}
      </span>
    </button>
  )
}

/** Sections without rows: each server still searching, empty or failed, then the notices. */
export function McpMentionStatus({ state }: { state: McpMentionSearchState }) {
  const { t } = useTranslation()
  const quiet = state.sources.filter(source => !source.items.length)
  if (!quiet.length && !state.failed && !state.incomplete) return null
  const line = (text: string) => <div className="px-2 py-1 text-2xs text-muted-foreground">{text}</div>
  return (
    <>
      {quiet.map(source => (
        <div key={mcpMentionGroupKey(source)}>
          <PopupSectionHeader label={source.title} />
          {line(state.loading
            ? t('chat.mentionPopup.mcpSearching')
            : state.failed || source.failed ? t('chat.mentionPopup.mcpSearchFailed') : t('chat.mentionPopup.mcpNoMatches'))}
        </div>
      ))}
      {state.failed && !state.sources.length ? line(t('chat.mentionPopup.mcpUnavailable')) : null}
      {state.incomplete ? line(t('chat.mentionPopup.mcpIncomplete')) : null}
    </>
  )
}
