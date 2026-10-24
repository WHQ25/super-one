import type { ReactNode } from 'react'
import type { McpResourceLink } from '@superone/shared/agent-types'
import { SINGLE_LINE_LINK_CLASS, type RenderArtifactLink } from './ArtifactListResult'

/** The local path a `file:` URI names, or null for any other scheme. */
export function fileUriPath(uri: string): string | null {
  if (!/^file:\/\//i.test(uri)) return null
  try {
    const path = decodeURIComponent(new URL(uri).pathname)
    // `file:///C:/x` parses to `/C:/x`.
    return /^\/[A-Za-z]:\//.test(path) ? path.slice(1) : path
  } catch {
    return null
  }
}

/**
 * Files an MCP result returned by reference, under the call's header: a local
 * file as the host's file chip, a web address as its link, any other scheme as
 * its name (only the server can read it).
 */
export function ResourceLinksResult({ links, renderFileChip, renderLink }: {
  links: McpResourceLink[]
  renderFileChip: (props: { name: string; title: string; filePath: string }) => ReactNode
  renderLink: RenderArtifactLink
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 px-2 pb-1.5 text-xs" onClick={(event) => event.stopPropagation()}>
      {links.map((link, index) => {
        const label = link.title || link.name || link.uri
        const path = fileUriPath(link.uri)
        return (
          <div key={`${index}:${link.uri}`} className="flex min-w-0 items-center gap-1.5">
            {path ? (
              renderFileChip({ name: label, title: link.description ?? path, filePath: path })
            ) : /^https?:\/\//i.test(link.uri) ? (
              <span className={SINGLE_LINE_LINK_CLASS}>{renderLink({ url: link.uri, label })}</span>
            ) : (
              <span className="min-w-0 truncate text-muted-foreground" title={link.uri}>{label}</span>
            )}
          </div>
        )
      })}
    </div>
  )
}
