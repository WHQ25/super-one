import type { PluginNoticeMeta } from '@superone/shared/agent-types'
import { Puzzle, TriangleAlert } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'

/** One plugin-authored line: whose it is, then the plugin's own plain text. */
function PluginLine({ plugin, text, isError, className }: { plugin: string; text: string; isError?: boolean; className?: string }) {
  const Icon = isError ? TriangleAlert : Puzzle
  return (
    <div className={cn('flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground', className)} title={`${plugin}: ${text}`}>
      <Icon className={cn('size-3 shrink-0', isError && 'text-error')} aria-hidden />
      <span className="shrink-0 font-medium">{plugin}</span>
      <span className="truncate text-muted-foreground/80">{text}</span>
    </div>
  )
}

/**
 * Transcript notice a plugin wrote (`plugin_notice` log), or a plugin that
 * failed to load. Dim and left-aligned like a system line: it is the user's to
 * read and was never part of the conversation with the model.
 */
export function PluginNoticeRow({ meta, text }: { meta: PluginNoticeMeta; text: string }) {
  return (
    <div className="my-0.5 flex w-0 min-w-full" data-plugin-notice={meta.plugin} role="note">
      <PluginLine plugin={meta.plugin} text={text} isError={meta.level === 'error'} className="max-w-[90%] px-0.5" />
    </div>
  )
}

/** The pinned status lines plugins keep above the composer, one per plugin. */
export function PluginStatusLines({ statuses }: { statuses: Record<string, string> }) {
  const entries = Object.entries(statuses)
  if (entries.length === 0) return null
  return (
    <div className="flex flex-col gap-0.5 px-3 pb-1" data-testid="plugin-status-lines" role="status">
      {entries.map(([plugin, text]) => <PluginLine key={plugin} plugin={plugin} text={text} />)}
    </div>
  )
}
