import { useEffect, useMemo, useRef, useState } from 'react'
import { useIsCodeFenceIncomplete } from 'streamdown'
import { AtSign, FolderOpen, Globe } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import { useIsDark } from '@/hooks/use-is-dark'
import { useTranslation } from 'react-i18next'
import { AdaptiveContextMenu } from '@/components/AdaptiveContextMenu'
import type { AdaptiveMenuEntry } from '@/lib/native-context-menu'
import { openFileTab, openBrowserTab } from '@/components/activity/activity-panel-api'
import { chatInputAPI } from '@/components/chat/ChatInput'
import { toMentionPath } from '@/components/chat/chat-input-utils'
import { DraggableFileIcon } from '@/components/chat/DraggableFileIcon'
import { useAppStore, selectEffectiveProjectRoot } from '@/stores/app'
import { useSourceControlStore } from '@/stores/source-control'
import { clickReleasedOnSelection, resolveProjectFileHref } from '@/lib/file-link'
import { requestOpenExternalLink } from '@/lib/external-link'

export function InlineFileChip({ name, filePath, lineNumber }: { name: string; filePath: string; lineNumber?: number }) {
  const { t } = useTranslation()
  const dragEndRef = useRef(0)
  /** Path to open/select: project-relative when under root, otherwise absolute. */
  const pathForOpen = (projectPath: string | null | undefined): string => {
    if (projectPath && filePath.startsWith(projectPath + '/')) {
      return filePath.slice(projectPath.length + 1)
    }
    return filePath
  }
  const handleClick = (e: React.MouseEvent): void => {
    if (Date.now() - dragEndRef.current < 200) return
    if (clickReleasedOnSelection(e.currentTarget)) return
    e.stopPropagation()
    const projectRoot = selectEffectiveProjectRoot(useAppStore.getState())
    const openPath = pathForOpen(projectRoot)
    // selectFile needs a project root for git/diff IPC; absolute external paths
    // still read via readProjectFile when the path is absolute.
    if (projectRoot) {
      void useSourceControlStore.getState().selectFile(projectRoot, openPath, lineNumber)
    }
    openFileTab(openPath)
  }
  const handleOpenFolder = (): void => {
    const projectRoot = selectEffectiveProjectRoot(useAppStore.getState())
    const openPath = pathForOpen(projectRoot)
    // Absolute openPath is revealed as-is; relative paths still need project root.
    if (openPath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(openPath)) {
      void window.app.showInFolder(projectRoot ?? openPath, openPath)
      return
    }
    if (!projectRoot) return
    void window.app.showInFolder(projectRoot, openPath)
  }
  const handleAddToChat = (): void => {
    const projectRoot = selectEffectiveProjectRoot(useAppStore.getState())
    chatInputAPI.insertMention?.('file', toMentionPath(filePath, projectRoot), name)
  }
  const menuItems: AdaptiveMenuEntry[] = [
    { kind: 'item', id: 'openFolder', label: t('sidebar.contextMenu.openFolder'), icon: FolderOpen, onSelect: handleOpenFolder },
    { kind: 'item', id: 'addToChat', label: t('sidebar.contextMenu.addToChat'), icon: AtSign, onSelect: handleAddToChat },
  ]
  return (
    <AdaptiveContextMenu items={menuItems}>
        <span
          role="button"
          onClick={handleClick}
          title={filePath}
          className="inline-flex cursor-pointer items-center gap-0.5 rounded bg-muted px-1 text-[0.9em] text-foreground whitespace-nowrap align-baseline translate-y-[1px] hover:bg-muted/80 transition-colors"
        >
          <DraggableFileIcon name={name} filePath={filePath} dragEndRef={dragEndRef} />
          <span>{name}</span>
          {lineNumber != null && <span className="text-muted-foreground text-[0.85em]">#L{lineNumber}</span>}
        </span>
    </AdaptiveContextMenu>
  )
}

const faviconClass = 'mr-1 inline-block size-[0.9em] shrink-0 object-contain align-[-0.1em]'

type FaviconAnalysis = { monochrome: boolean; transparent: boolean; luminance: number }
type FaviconSource = 'globe' | { dataUrl: string; analysis: FaviconAnalysis | null }

function analyzeFavicon(img: HTMLImageElement): FaviconAnalysis | null {
  try {
    const w = Math.min(img.naturalWidth || 32, 32)
    const h = Math.min(img.naturalHeight || 32, 32)
    if (!w || !h) return null
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, w, h)
    const { data } = ctx.getImageData(0, 0, w, h)
    let opaque = 0
    let colored = 0
    let translucent = 0
    let lumSum = 0
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 32) {
        translucent++
        continue
      }
      opaque++
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      if (Math.max(r, g, b) - Math.min(r, g, b) > 24) colored++
      lumSum += (0.299 * r + 0.587 * g + 0.114 * b) / 255
    }
    if (!opaque) return null
    const total = opaque + translucent
    return { monochrome: colored / opaque < 0.02, transparent: translucent / total > 0.05, luminance: lumSum / opaque }
  } catch {
    return null
  }
}

function contrastRatio(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

function needsContrastBoost(dataUrl: string, analysis: FaviconAnalysis | null, isDark: boolean): boolean {
  if (!analysis || !analysis.monochrome || !analysis.transparent) return false
  if (!/^data:image\/(svg\+xml|png)/.test(dataUrl)) return false
  return contrastRatio(analysis.luminance, isDark ? 0.12 : 0.98) < 3
}

function LinkFavicon({ href }: { href: string }) {
  const incomplete = useIsCodeFenceIncomplete()
  const isDark = useIsDark()
  const [source, setSource] = useState<FaviconSource>('globe')

  const isHttp = useMemo(() => {
    try {
      const { protocol } = new URL(href)
      return protocol === 'http:' || protocol === 'https:'
    } catch {
      return false
    }
  }, [href])

  useEffect(() => {
    if (!isHttp || incomplete) return
    let cancelled = false
    void window.app.resolveFavicon(href, isDark).then((dataUrl) => {
      if (cancelled) return
      if (!dataUrl) {
        setSource('globe')
        return
      }
      const img = new Image()
      img.onload = () => { if (!cancelled) setSource({ dataUrl, analysis: analyzeFavicon(img) }) }
      img.onerror = () => { if (!cancelled) setSource('globe') }
      img.src = dataUrl
    })
    return () => { cancelled = true }
  }, [href, isHttp, incomplete, isDark])

  if (!isHttp) return null
  if (source === 'globe') return <Globe className={`${faviconClass} text-muted-foreground`} />
  const scheme = isDark ? 'dark' : 'light'
  if (needsContrastBoost(source.dataUrl, source.analysis, isDark)) {
    const mask = `url("${source.dataUrl}")`
    return (
      <span
        aria-hidden
        className={`${faviconClass} bg-foreground`}
        style={{
          maskImage: mask,
          WebkitMaskImage: mask,
          maskSize: 'contain',
          WebkitMaskSize: 'contain',
          maskRepeat: 'no-repeat',
          WebkitMaskRepeat: 'no-repeat',
          maskPosition: 'center',
          WebkitMaskPosition: 'center',
        }}
      />
    )
  }
  return <img key={scheme} src={source.dataUrl} alt="" className={faviconClass} style={{ colorScheme: scheme }} onError={() => setSource('globe')} />
}

/** Flatten React children to plain text for chip label selection. */
function linkTextContent(children: React.ReactNode): string {
  if (children == null || typeof children === 'boolean') return ''
  if (typeof children === 'string' || typeof children === 'number') return String(children)
  if (Array.isArray(children)) return children.map(linkTextContent).join('')
  if (typeof children === 'object' && children !== null && 'props' in children) {
    const el = children as React.ReactElement<{ children?: React.ReactNode }>
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
  children: React.ReactNode,
  rawHref: string | undefined,
  filePath: string,
): string {
  const basename = filePath.split(/[/\\]/).pop() || ''
  const linkText = linkTextContent(children).trim()
  if (!linkText || linkText === rawHref) return basename
  // Pure line-range labels from code citations — not a filename.
  if (/^L\d+(?:\s*[-–—]\s*\d+)?$/i.test(linkText)) return basename
  // "file.ts:12" / "file.ts#L12" → use the name portion (chip renders #L separately).
  const withoutLine = linkText.replace(/(?::\d+|#L\d+)(?:-\d+)*$/i, '').trim()
  return withoutLine || basename
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
      return <InlineFileChip name={name} filePath={resolved.filePath} lineNumber={resolved.lineNumber} />
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
