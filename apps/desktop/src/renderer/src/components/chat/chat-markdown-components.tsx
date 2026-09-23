import { useRef } from 'react'
import { cn } from '@superone/ui/lib/utils'
import { useIsDark } from '@/hooks/use-is-dark'
import { AdaptiveContextMenu } from '@/components/AdaptiveContextMenu'
import { openFileTab, openBrowserTab } from '@/components/activity/activity-panel-api'
import { DraggableFileIcon } from '@/components/chat/DraggableFileIcon'
import { useFileChipContextMenu } from '@/components/chat/file-chip-context-menu'
import { useAppStore, selectEffectiveProjectRoot } from '@/stores/app'
import { useSourceControlStore } from '@/stores/source-control'
import { clickReleasedOnSelection, formatLineRange, resolveProjectFileHref, toProjectRelativePath } from '@/lib/file-link'
import { requestOpenExternalLink } from '@/lib/external-link'
import { fileChipLabel } from '@superone/chat-view/presenters/file-chip-label'
import { LinkFaviconPresenter, type LinkFaviconPorts } from '@superone/chat-view/presenters/LinkFavicon'

export { fileChipLabel }

export function InlineFileChip({ name, filePath, lineNumber, endLine }: { name: string; filePath: string; lineNumber?: number; endLine?: number }) {
  const dragEndRef = useRef(0)
  const menuItems = useFileChipContextMenu(filePath)
  const handleClick = (e: React.MouseEvent): void => {
    if (Date.now() - dragEndRef.current < 200) return
    if (clickReleasedOnSelection(e.currentTarget)) return
    e.stopPropagation()
    const projectRoot = selectEffectiveProjectRoot(useAppStore.getState())
    const openPath = toProjectRelativePath(filePath, projectRoot)
    // selectFile needs a project root for git/diff IPC; absolute external paths
    // still read via readProjectFile when the path is absolute.
    if (projectRoot) {
      void useSourceControlStore.getState().selectFile(projectRoot, openPath, lineNumber)
    }
    openFileTab(openPath)
  }
  return (
    <AdaptiveContextMenu items={menuItems}>
        <span
          role="button"
          onClick={handleClick}
          title={filePath}
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

const faviconPorts: LinkFaviconPorts = {
  resolveFavicon: (href, isDark) => window.app.resolveFavicon(href, isDark),
}

function LinkFavicon({ href }: { href: string }) {
  const isDark = useIsDark()
  return <LinkFaviconPresenter href={href} isDark={isDark} ports={faviconPorts} />
}

function FileLink(props: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  const { href: rawHref, children, className, ...rest } = props
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
  return (
    <a
      href={rawHref}
      className={cn(className, 'no-underline hover:underline hover:decoration-1 hover:underline-offset-2')}
      {...rest}
      onClick={(e) => {
        if (!rawHref) return
        e.preventDefault()
        const openInApp = window.app.platform === 'darwin' ? e.metaKey : e.ctrlKey
        if (openInApp) {
          openBrowserTab(rawHref)
          return
        }
        requestOpenExternalLink(rawHref)
      }}
    >
      {rawHref && <LinkFavicon href={rawHref} />}
      {children}
    </a>
  )
}

export const fileLinkComponents = { a: FileLink }
