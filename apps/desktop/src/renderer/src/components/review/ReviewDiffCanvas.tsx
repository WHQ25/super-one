import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { parsePatchFiles, type FileDiffMetadata } from '@pierre/diffs'
import {
  FileDiff,
  type SelectedLineRange,
} from '@pierre/diffs/react'
import { ChevronRight } from 'lucide-react'
import {
  AUDIO_EXTENSIONS,
  BINARY_IMAGE_EXTENSIONS,
  MARKDOWN_EXTENSIONS,
  MODEL_EXTENSIONS,
  NOTEBOOK_EXTENSIONS,
  PDF_EXTENSIONS,
  VIDEO_EXTENSIONS,
  officePreviewKind,
} from '@superone/shared/file-preview'
import type { ReviewFileDiff, ReviewScope } from '@superone/shared/review-types'
import { cn } from '@superone/ui/lib/utils'
import { FileChip } from '@/components/chat/FileChip'
import { FileSelectionContextMenuZone, type CapturedFileSelection } from '@/components/coding/FileSelectionContextMenuZone'
import { SidebarCollapse } from '@/components/sidebar/SidebarCollapse'
import { useIsDark } from '@/hooks/use-is-dark'
import { ReviewLspHoverCard } from './ReviewLspHoverCard'
import { ReviewStickyLayer } from './ReviewStickyLayer'
import {
  buildFullFilePath,
  formatReviewSelectionQuote,
  normalizeLineSelection,
} from './review-diff-utils'
import { useReviewLsp } from './useReviewLsp'

const LazyFilePreview = lazy(() =>
  import('@/components/coding/FilePreview').then((m) => ({ default: m.FilePreview })),
)

function fileExtensionOf(path: string): string {
  const dot = path.lastIndexOf('.')
  return dot < 0 ? '' : path.slice(dot).toLowerCase()
}

function isMultimediaPreviewPath(path: string): boolean {
  const ext = fileExtensionOf(path)
  return (
    BINARY_IMAGE_EXTENSIONS.has(ext) ||
    VIDEO_EXTENSIONS.has(ext) ||
    AUDIO_EXTENSIONS.has(ext) ||
    PDF_EXTENSIONS.has(ext) ||
    MODEL_EXTENSIONS.has(ext) ||
    officePreviewKind(path) !== null
  )
}

function isRichTextPreviewPath(path: string): boolean {
  const ext = fileExtensionOf(path)
  return (
    MARKDOWN_EXTENSIONS.has(ext) ||
    NOTEBOOK_EXTENSIONS.has(ext) ||
    ext === '.svg' ||
    ext === '.html' ||
    ext === '.htm'
  )
}

function middleTruncatePath(path: string, maxChars: number): string {
  if (path.length <= maxChars || maxChars < 12) return path
  const lastSlash = path.lastIndexOf('/')
  const base = lastSlash >= 0 ? path.slice(lastSlash) : ''
  if (base.length > 0 && base.length + 6 < maxChars) {
    const headBudget = maxChars - base.length - 1
    return `${path.slice(0, headBudget)}…${base}`
  }
  const head = Math.max(4, Math.floor((maxChars - 1) * 0.42))
  const tail = Math.max(4, maxChars - 1 - head)
  return `${path.slice(0, head)}…${path.slice(path.length - tail)}`
}

interface ReviewDiffCanvasProps {
  file: ReviewFileDiff
  scope: ReviewScope
  workspaceRoot: string
  diffStyle: 'split' | 'unified'
  wordWrap?: boolean
  richPreview?: boolean
  maxPathChars?: number
  collapsed?: boolean
  lazyViewport?: boolean
  scrollRootRef?: RefObject<HTMLElement | null>
  onToggleCollapse?: () => void
  lspAllowed: boolean
}

const DIFF_SURFACE_STYLE = {
  '--diffs-light-bg': 'transparent',
  '--diffs-dark-bg': 'transparent',
  '--diffs-bg': 'transparent',
} as React.CSSProperties

export function ReviewDiffCanvas({
  file,
  scope,
  workspaceRoot,
  diffStyle,
  wordWrap = false,
  richPreview = false,
  maxPathChars = 48,
  collapsed = false,
  lazyViewport = false,
  scrollRootRef,
  onToggleCollapse,
  lspAllowed,
}: ReviewDiffCanvasProps) {
  const { t } = useTranslation()
  const isDark = useIsDark()
  const selectedLinesRef = useRef<SelectedLineRange | null>(null)
  const [dragSelectedLines, setDragSelectedLines] = useState<SelectedLineRange | null>(null)
  const diffWrapperRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const [hasEnteredViewport, setHasEnteredViewport] = useState(
    () => !lazyViewport || typeof IntersectionObserver === 'undefined',
  )
  const [diskState, setDiskState] = useState<{ content: string | null; matchesDisk: boolean }>({
    content: null,
    matchesDisk: false,
  })
  const cacheVersionRef = useRef(0)

  useLayoutEffect(() => {
    if (!lazyViewport || typeof IntersectionObserver === 'undefined') {
      setHasEnteredViewport(true)
      return
    }
    if (collapsed) {
      setHasEnteredViewport(false)
      return
    }
    if (hasEnteredViewport) return
    const el = hostRef.current
    if (!el) return
    const rootEl = scrollRootRef?.current ?? null
    const rootRect = rootEl ? rootEl.getBoundingClientRect() : { top: 0, bottom: window.innerHeight || 900 }
    const rect = el.getBoundingClientRect()
    if (rect.bottom >= rootRect.top - 250 && rect.top <= rootRect.bottom + 250) {
      setHasEnteredViewport(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setHasEnteredViewport(true)
          observer.disconnect()
        }
      },
      { root: rootEl, rootMargin: '250px 0px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [collapsed, hasEnteredViewport, lazyViewport, scrollRootRef])

  useEffect(() => {
    selectedLinesRef.current = null
    cacheVersionRef.current += 1
  }, [file.path, file.patch, scope])

  useEffect(() => {
    let cancelled = false
    setDiskState({ content: null, matchesDisk: false })
    if (collapsed || !hasEnteredViewport || !workspaceRoot || !file.path || file.isBinary || file.status === 'deleted') return
    if (typeof window.app?.getReviewFileContents !== 'function') return

    void window.app.getReviewFileContents(workspaceRoot, file.path).then((pair) => {
      if (cancelled) return
      setDiskState({ content: pair.newContent, matchesDisk: pair.matchesDisk })
    }).catch(() => {})

    return () => { cancelled = true }
  }, [collapsed, hasEnteredViewport, workspaceRoot, file.path, file.patch, file.isBinary, file.status])

  const parsedFileDiff = useMemo<FileDiffMetadata | null>(() => {
    if (collapsed || !file.patch.trim() || file.isBinary) return null
    const parsed = parsePatchFiles(file.patch, {
      cacheKeyPrefix: `review-${scope}-${file.path}-${cacheVersionRef.current}`,
    })
    return parsed[0]?.files[0] ?? null
  }, [collapsed, file.patch, file.isBinary, file.path, scope])

  const lsp = useReviewLsp({
    workspaceRoot,
    filePath: lspAllowed && !collapsed && hasEnteredViewport ? file.path : null,
    diskContent: diskState.content,
    matchesDisk: lspAllowed && !collapsed && hasEnteredViewport && diskState.matchesDisk,
  })

  const loadDiffFiles = useCallback(async () => {
    if (typeof window.app?.getReviewFileContents !== 'function') {
      return { oldFile: null, newFile: { name: file.path, contents: '' } }
    }
    const pair = await window.app.getReviewFileContents(workspaceRoot, file.path)
    if (pair.oldContent === null) {
      return {
        oldFile: null,
        newFile: { name: file.path, contents: pair.newContent ?? '' },
      }
    }
    return {
      oldFile: { name: file.oldPath ?? file.path, contents: pair.oldContent },
      newFile: { name: file.path, contents: pair.newContent ?? '' },
    }
  }, [workspaceRoot, file.path, file.oldPath])

  const captureDiffSelection = useCallback((): CapturedFileSelection | null => {
    const range = selectedLinesRef.current
    if (range) {
      const normalized = normalizeLineSelection(range)
      const quoteText = formatReviewSelectionQuote(file.path, normalized, file.patch)
      const codeLines = quoteText.split('\n').slice(1).join('\n')
      return {
        copyText: codeLines || quoteText,
        quoteText,
      }
    }
    const sel = window.getSelection()
    const text = sel?.toString() ?? ''
    if (!text.trim()) return null
    return {
      copyText: text,
      quoteText: `${file.path}\n${text}`,
    }
  }, [file.path, file.patch])

  const selectContentForRange = useCallback((range: SelectedLineRange) => {
    const shadow = diffWrapperRef.current?.querySelector('diffs-container')?.shadowRoot
    if (!shadow) return
    const start = Math.min(range.start, range.end)
    const end = Math.max(range.start, range.end)
    let firstNode: Text | null = null
    let lastNode: Text | null = null
    for (let ln = start; ln <= end; ln++) {
      const lineEl = shadow.querySelector<HTMLElement>(`[data-line="${ln}"]`)
      if (!lineEl) continue
      const walker = document.createTreeWalker(lineEl, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const parent = node.parentElement
          if (!parent || parent.closest('[data-column-number]')) return NodeFilter.FILTER_REJECT
          return node.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
        },
      })
      let cur = walker.nextNode() as Text | null
      while (cur) {
        if (!firstNode) firstNode = cur
        lastNode = cur
        cur = walker.nextNode() as Text | null
      }
    }
    if (firstNode && lastNode) {
      try {
        window.getSelection()?.setBaseAndExtent(firstNode, 0, lastNode, lastNode.length)
      } catch {
        // Ignore if selection cannot cross shadow boundary in test environments
      }
    }
  }, [])

  const diffOptions = useMemo(() => ({
    diffStyle,
    collapsed,
    theme: { light: 'pierre-light', dark: 'pierre-dark' },
    themeType: isDark ? ('dark' as const) : ('light' as const),
    disableFileHeader: true,
    hunkSeparators: 'line-info' as const,
    overflow: wordWrap ? ('wrap' as const) : ('scroll' as const),
    enableLineSelection: true,
    useTokenTransformer: lsp.lspReady,
    loadDiffFiles: scope === 'workspace' ? loadDiffFiles : undefined,
    onLineSelectionChange: (range: SelectedLineRange | null) => {
      selectedLinesRef.current = range
      setDragSelectedLines(range)
    },
    onLineSelectionEnd: (range: SelectedLineRange | null) => {
      selectedLinesRef.current = range
      setDragSelectedLines(null)
      if (range) selectContentForRange(range)
    },
    onTokenEnter: lsp.onTokenEnter,
    onTokenLeave: lsp.onTokenLeave,
    onTokenClick: lsp.onTokenClick,
  }), [
    diffStyle,
    collapsed,
    isDark,
    wordWrap,
    lsp.lspReady,
    lsp.onTokenEnter,
    lsp.onTokenLeave,
    lsp.onTokenClick,
    scope,
    loadDiffFiles,
  ])

  const fullPath = useMemo(
    () => (workspaceRoot ? buildFullFilePath(workspaceRoot, file.path) : file.path),
    [workspaceRoot, file.path],
  )

  const shouldShowPreview =
    file.status !== 'deleted' &&
    Boolean(workspaceRoot) &&
    (isMultimediaPreviewPath(file.path) || (richPreview && isRichTextPreviewPath(file.path)))

  const displayName = useMemo(
    () => middleTruncatePath(file.path, maxPathChars),
    [file.path, maxPathChars],
  )

  const headerContent = (
    <div
      onClick={onToggleCollapse}
      style={collapsed ? undefined : { backgroundColor: 'var(--review-sticky-bg, var(--card))' }}
      className="group/header flex h-9 w-full cursor-pointer items-center justify-between gap-2 px-3 select-none"
    >
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden pr-2">
        <span
          className="min-w-0 max-w-full overflow-hidden text-xs leading-4 [&_svg]:size-3.5"
          onClick={(e) => e.stopPropagation()}
        >
          <FileChip name={displayName} title={file.path} filePath={fullPath} className="text-xs leading-4" />
        </span>
        <span className="inline-flex size-4 shrink-0 items-center justify-center text-muted-foreground opacity-0 transition-opacity duration-[120ms] group-hover/header:opacity-100">
          <ChevronRight className={cn('size-3.5 transition-transform duration-[120ms] ease-out', !collapsed && 'rotate-90')} />
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-2 font-mono text-[11px]">
        {file.additions > 0 && (
          <span className="text-emerald-600 dark:text-emerald-400">+{file.additions}</span>
        )}
        {file.deletions > 0 && (
          <span className="text-rose-600 dark:text-rose-400">-{file.deletions}</span>
        )}
      </div>
    </div>
  )

  const renderBody = () => {
    if (shouldShowPreview) {
      if (!hasEnteredViewport) {
        const estimatedHeight = Math.min(480, Math.max(80, (file.additions + file.deletions) * 20))
        return <div style={{ height: `${estimatedHeight}px` }} />
      }
      const ext = fileExtensionOf(file.path)
      const needsFixedViewport =
        PDF_EXTENSIONS.has(ext) || MODEL_EXTENSIONS.has(ext) || officePreviewKind(file.path) !== null
      const isAudio = AUDIO_EXTENSIONS.has(ext)
      const isRichText = richPreview && isRichTextPreviewPath(file.path) && !isMultimediaPreviewPath(file.path)
      const previewContainerClass = isRichText || isAudio
        ? 'w-full'
        : needsFixedViewport
          ? 'h-[460px] min-h-[240px] w-full overflow-hidden'
          : 'w-full overflow-hidden [&_img]:max-h-[440px] [&_img]:w-auto [&_img]:object-contain [&_video]:max-h-[380px] [&_video]:w-auto [&_video]:object-contain'
      return (
        <div className={previewContainerClass}>
          <Suspense fallback={<div className="flex min-h-32 items-center justify-center text-xs text-muted-foreground">Loading…</div>}>
            <LazyFilePreview filePath={file.path} fileRoot={workspaceRoot} hideHeader />
          </Suspense>
        </div>
      )
    }
    if (file.isBinary || !parsedFileDiff) {
      return (
        <div className="px-4 py-3 text-xs text-muted-foreground">
          {file.isBinary ? t('review.empty.binaryFile') : t('review.empty.emptyPatch')}
        </div>
      )
    }
    return (
      <FileSelectionContextMenuZone filePath={fullPath} captureSelection={captureDiffSelection} className="relative">
        <div ref={diffWrapperRef} className="relative">
          <ReviewStickyLayer containerRef={diffWrapperRef} fullPath={fullPath} relPath={file.path}>
            <FileDiff
              fileDiff={parsedFileDiff}
              options={diffOptions}
              style={DIFF_SURFACE_STYLE}
              selectedLines={dragSelectedLines}
            />
          </ReviewStickyLayer>
        </div>
      </FileSelectionContextMenuZone>
    )
  }

  return (
    <div ref={hostRef} className="border-b border-border/60">
      <div className={cn(!collapsed && 'sticky top-0 z-10 border-b border-border/50')}>
        {headerContent}
      </div>
      <SidebarCollapse open={!collapsed} unmountClosed>
        {renderBody()}
      </SidebarCollapse>
      {lsp.hoverCard && (
        <ReviewLspHoverCard hover={lsp.hoverCard} onDismiss={lsp.dismissHover} />
      )}
    </div>
  )
}
