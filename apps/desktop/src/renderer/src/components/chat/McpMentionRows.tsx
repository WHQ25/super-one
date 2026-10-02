/**
 * Mention popup rows for MCP servers that declare `mentions/search`: one item
 * row per result, and the per-server status lines (searching, no matches,
 * failed) plus the "some servers have not answered" notice.
 */
import { useTranslation } from 'react-i18next'
import { cn } from '@superone/ui/lib/utils'
import { mcpResourceMentionIcon } from '@superone/ui/components/ui/mention-icons'
import type { McpMentionItem, McpMentionSource } from '@superone/shared/mcp-app-mentions'
import type { McpMentionSearchState } from '@/components/mcp-apps/mention-search'
import { PopupSectionHeader } from './popup-groups'
import { STACKED_BODY_CLASS, STACKED_DETAIL_CLASS, STACKED_ICON_CLASS, STACKED_ROW_CLASS, mentionRowClass } from './mention-row-layout'

export interface McpMentionFlatItem { kind: 'mcp-resource'; server: string; tool: string; title: string; sourceIcon?: string; item: McpMentionItem }

export const mcpMentionGroupKey = (source: Pick<McpMentionSource, 'server' | 'tool'>) => `mcp:${source.server}/${source.tool}`

export function mcpMentionFlatItems(sources: McpMentionSource[]): McpMentionFlatItem[] {
  return sources.flatMap(({ server, tool, title, icon, items }) =>
    items.map(item => ({ kind: 'mcp-resource' as const, server, tool, title, ...(icon ? { sourceIcon: icon } : {}), item })))
}

/** Something the popup must stay open for even with no selectable rows. */
export function mcpMentionHasStatus(state: McpMentionSearchState): boolean {
  return state.failed || state.incomplete || state.sources.some(source => source.failed || (state.loading && !source.items.length))
}

function McpIcon({ src, className }: { src?: string; className?: string }) {
  return src
    ? <img src={src} alt="" className={cn('size-3.5 shrink-0 rounded-sm object-contain', className)} />
    : <span className={cn('flex size-3.5 shrink-0 [&>svg]:size-3.5', className)}>{mcpResourceMentionIcon('text-muted-foreground')}</span>
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
      <McpIcon src={item.icon ?? entry.sourceIcon} className={item.detail ? STACKED_ICON_CLASS : undefined} />
      <span className={STACKED_BODY_CLASS}>
        <span className="min-w-0 truncate font-medium @md:flex-1">{item.label}</span>
        {item.detail ? <span className={cn(STACKED_DETAIL_CLASS, '@md:max-w-[50%] @md:shrink-0')}>{item.detail}</span> : null}
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
