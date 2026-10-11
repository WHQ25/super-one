import { isSessionLink } from '@superone/shared/session-link'
import { SessionChip, sessionChipLabel } from '@superone/chat-view/presenters/SessionChip'
import { AdaptiveContextMenu } from '@/components/AdaptiveContextMenu'
import { DraggableFileIcon } from '@/components/chat/DraggableFileIcon'
import { useFileChipActions } from '@/components/chat/file-chip-context-menu'
import { useAppStore, selectEffectiveProjectRoot } from '@/stores/app'
import { formatLineRange, hasTextSelection, resolveProjectFileHref } from '@/lib/file-link'
import { fileChipLabel } from '@superone/chat-view/presenters/file-chip-label'
import { WebLink } from './link-preview/WebLink'

export { fileChipLabel }

export function InlineFileChip({ name, filePath, lineNumber, endLine }: { name: string; filePath: string; lineNumber?: number; endLine?: number }) {
  const { dragEndRef, menu, handleClick } = useFileChipActions(filePath, lineNumber)
  return (
    <AdaptiveContextMenu items={menu.items} onOpen={menu.onOpen} yieldWhen={hasTextSelection}>
        <span
          role="button"
          onClick={handleClick}
          title={filePath}
          data-selection-fill=""
          // Copies back as the Markdown link it was rendered from.
          data-copy-text={`[${name}](${filePath}${lineNumber != null ? formatLineRange(lineNumber, endLine) : ''})`}
          className="inline-flex max-w-full cursor-pointer items-center gap-0.5 rounded bg-muted px-1 text-[0.9em] text-foreground whitespace-nowrap align-baseline translate-y-[1px] hover:bg-muted/80 transition-colors"
        >
          <DraggableFileIcon name={name} filePath={filePath} dragEndRef={dragEndRef} />
          <span className="min-w-0 truncate">{name}</span>
          {lineNumber != null && (
            <span className="shrink-0 text-muted-foreground text-[0.85em]">{formatLineRange(lineNumber, endLine)}</span>
          )}
        </span>
    </AdaptiveContextMenu>
  )
}

export function FileLink(props: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  const { href: rawHref, children, className, ...rest } = props
  if (rawHref && isSessionLink(rawHref)) return <SessionChip href={rawHref} label={sessionChipLabel(children)} />
  const projectRoot = selectEffectiveProjectRoot(useAppStore.getState()) ?? ''
  // Expand ~/… (Grok often cites ~/.grok/sessions/… artifacts).
  let homeDir: string | undefined
  try {
    homeDir = typeof process !== 'undefined' ? (process.env?.HOME || process.env?.USERPROFILE) : undefined
  } catch { /* ignore */ }
  if (rawHref) {
    const resolved = resolveProjectFileHref(rawHref, projectRoot, homeDir)
    if (resolved) {
      const name = fileChipLabel(children, rawHref, resolved.filePath)
      return (
        <InlineFileChip
          name={name}
          filePath={resolved.filePath}
          lineNumber={resolved.lineNumber}
          endLine={resolved.endLine}
        />
      )
    }
  }
  return <WebLink href={rawHref} className={className} {...rest}>{children}</WebLink>
}

export const fileLinkComponents = { a: FileLink }
