import { useTranslation } from 'react-i18next'
import { cn } from '@superone/ui/lib/utils'
import type { TrajectoryHeaderDiff } from '@superone/shared/trajectory-types'
import { LINE_STYLE } from '@/lib/diff-utils'

/** One labelled group of changed tool names. */
function ToolChanges({ label, names }: { label: string; names: string[] }) {
  if (names.length === 0) return null
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">{label}</span>
      {names.map((name) => (
        <span key={name} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">{name}</span>
      ))}
    </div>
  )
}

/**
 * What one request-header snapshot changed relative to the one before it.
 *
 * dsh only logs a header when it differs, so a rendered diff always has
 * something in it — an all-empty diff would mean the projection paired the
 * wrong snapshots, which is worth showing rather than hiding behind a blank pane.
 */
export function PromptDiff({ diff }: { diff: TrajectoryHeaderDiff }) {
  const { t } = useTranslation()
  const empty = diff.config.length === 0
    && !diff.systemChanged
    && diff.toolsAdded.length === 0
    && diff.toolsRemoved.length === 0
    && diff.toolsChanged.length === 0

  if (empty) {
    return <div className="p-3 text-[11px] text-muted-foreground">{t('trajectory.inspector.noChanges')}</div>
  }

  return (
    <div className="flex flex-col gap-4 p-3">
      {diff.config.length > 0 && (
        <section className="flex flex-col gap-1">
          <h4 className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
            {t('trajectory.inspector.configChanged')}
          </h4>
          <table className="w-full text-[11px]">
            <tbody>
              {diff.config.map((change) => (
                <tr key={change.field}>
                  <td className="w-28 py-0.5 pr-2 font-mono text-muted-foreground">{change.field}</td>
                  <td className="py-0.5 font-mono">
                    <span className="text-muted-foreground line-through">{change.before ?? '—'}</span>
                    <span className="px-1.5 text-muted-foreground/60">→</span>
                    <span>{change.after ?? '—'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {(diff.toolsAdded.length > 0 || diff.toolsRemoved.length > 0 || diff.toolsChanged.length > 0) && (
        <section className="flex flex-col gap-1.5">
          <h4 className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
            {t('trajectory.inspector.toolsChanged')}
          </h4>
          <ToolChanges label={t('trajectory.inspector.toolsAdded')} names={diff.toolsAdded} />
          <ToolChanges label={t('trajectory.inspector.toolsRemoved')} names={diff.toolsRemoved} />
          <ToolChanges label={t('trajectory.inspector.toolsRetitled')} names={diff.toolsChanged} />
        </section>
      )}

      {diff.systemChanged && (
        <section className="flex flex-col gap-1">
          <h4 className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
            {t('trajectory.inspector.promptChanged')}
          </h4>
          <div className="overflow-x-auto rounded border border-border">
            {diff.systemHunks.map((hunk) => (
              <div key={`${hunk.oldStart}:${hunk.newStart}`} className="border-b border-border last:border-b-0">
                <div className="bg-muted/50 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                  @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
                </div>
                {hunk.lines.map((line, index) => {
                  // Same palette the file-diff viewer uses, so a prompt change
                  // reads exactly like a code change elsewhere in the app.
                  const kind = line.startsWith('+') ? 'added' : line.startsWith('-') ? 'removed' : 'unchanged'
                  return (
                    <div
                      key={index}
                      className={cn(
                        'whitespace-pre px-2 font-mono text-[11px] leading-5',
                        LINE_STYLE[kind].bg,
                        kind === 'unchanged' && 'text-muted-foreground',
                      )}
                    >
                      {line}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
