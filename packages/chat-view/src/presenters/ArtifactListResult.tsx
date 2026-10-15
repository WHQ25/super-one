import type { ReactNode } from 'react'
import type { ArtifactLink, ArtifactListLine } from './artifact-link'

/** Keeps a favicon link on one line, truncated, inside a single-line slot. */
export const SINGLE_LINE_LINK_CLASS = 'min-w-0 truncate [&_.text-wrap]:text-nowrap'

/** The host's chat markdown web link (favicon, preview on desktop), unstyled by the row. */
export type RenderArtifactLink = (props: ArtifactLink) => ReactNode

/** An expanded `Artifact` list: each artifact as its titled link and last update. */
export function ArtifactListResult({ lines, renderLink }: { lines: ArtifactListLine[]; renderLink: RenderArtifactLink }) {
  return (
    <div className="rounded bg-background/70 px-2 py-1.5 text-xs leading-relaxed">
      {lines.map((line, index) => line.kind === 'note' ? (
        <div key={index} className="text-muted-foreground">{line.text}</div>
      ) : (
        <div key={index} className="flex min-w-0 items-center gap-2">
          <span className={SINGLE_LINE_LINK_CLASS}>
            {renderLink({ url: line.item.url, label: line.item.label })}
          </span>
          {line.item.tags.map((tag) => (
            <span key={tag} className="shrink-0 rounded bg-muted px-1 text-muted-foreground">{tag}</span>
          ))}
          {line.item.updated && (
            <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">{line.item.updated}</span>
          )}
        </div>
      ))}
    </div>
  )
}
