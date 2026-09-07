import type { ReactElement, ReactNode } from 'react'

/** Flatten React children to plain text for chip label selection. */
function linkTextContent(children: ReactNode): string {
  if (children == null || typeof children === 'boolean') return ''
  if (typeof children === 'string' || typeof children === 'number') return String(children)
  if (Array.isArray(children)) return children.map(linkTextContent).join('')
  if (typeof children === 'object' && children !== null && 'props' in children) {
    const el = children as ReactElement<{ children?: ReactNode }>
    return linkTextContent(el.props?.children)
  }
  return ''
}

/**
 * Chip label: prefer markdown link text when present and useful; fall back to
 * basename. Line-only labels (`L12-14`) and bare href echoes are not useful.
 * Strip a trailing `:N` / `#LN` from link text so the chip can show `#L` from
 * the resolved line once instead of duplicating the line annotation.
 */
export function fileChipLabel(
  children: ReactNode,
  rawHref: string | undefined,
  filePath: string,
): string {
  const basename = filePath.split(/[/\\]/).pop() || ''
  const linkText = linkTextContent(children).trim()
  if (!linkText || linkText === rawHref) return basename
  // Pure line-range labels from code citations — not a filename.
  if (/^L\d+(?:\s*[-–—]\s*L?\d+)?$/i.test(linkText)) return basename
  // "file.ts:12" / "file.ts#L12" → use the name portion (chip renders #L separately).
  const withoutLine = linkText.replace(/(?::\d+|#L\d+)(?:\s*[-–—]\s*L?\d+)?$/i, '').trim()
  return withoutLine || basename
}
