import { useCallback, useRef, useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { FileX2, ChevronRight, RefreshCw } from 'lucide-react'
import { FileIcon } from '@superone/ui/components/ui/FileIcon'
import { Button } from '@superone/ui/components/ui/button'
import { cn } from '@superone/ui/lib/utils'
import { Tabs, TabsList, TabsTrigger } from '@superone/ui/components/ui/tabs'
import { useEffectiveProjectRoot } from '@/stores/app'
import { isAbsoluteLocalPath } from '@/lib/file-link'
import { localFileUrlToPath, toLocalFileUrl, toMediaUrl } from '@/lib/path-utils'

/**
 * What a media preview loads. The host answers with bytes (a data URI) for a
 * file on a node, with the URL of the desktop mirror for a file in the
 * session zone, and with nothing for a plain local file — which is then
 * loaded from its own path. Streams (video, audio) go through the media
 * server when a local path is known, so a large mirror plays by range.
 */
function previewSrc(content: string | undefined, fromPath: () => string, stream?: (path: string) => string): string {
  if (!content) return fromPath()
  if (content.startsWith('data:')) return content
  const mirror = localFileUrlToPath(content)
  if (mirror) return stream ? stream(mirror) : content
  return fromPath()
}
import { PdfPreview } from '@/components/chat/PdfPreview'
import type { GitFileDiff, GitFileContent } from '@superone/shared/agent-types'
import {
  AUDIO_EXTENSIONS,
  BINARY_IMAGE_EXTENSIONS,
  MARKDOWN_EXTENSIONS,
  NOTEBOOK_EXTENSIONS,
  PDF_EXTENSIONS,
  VIDEO_EXTENSIONS,
} from '@superone/shared/file-preview'
import { FileDiffView } from './source-control/FileDiffView'
import { FileWithDiffView } from './source-control/FileWithDiffView'
import { ImagePreview } from './ImagePreview'
import { MarkdownEditor } from './MarkdownEditor'
import { NotebookPreview } from './NotebookPreview'
import { TextFileEditor } from './TextFileEditor'
import { FileSelectionContextMenuZone } from './FileSelectionContextMenuZone'

const MARKDOWN_EXTS = MARKDOWN_EXTENSIONS
const NOTEBOOK_EXTS = NOTEBOOK_EXTENSIONS
const BINARY_IMAGE_EXTS = BINARY_IMAGE_EXTENSIONS
const PDF_EXTS = PDF_EXTENSIONS
const VIDEO_EXTS = VIDEO_EXTENSIONS
const AUDIO_EXTS = AUDIO_EXTENSIONS

/** Dotted, lower-case, matching the shared extension tables. */
function getFileExt(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot < 0 ? '' : fileName.slice(dot).toLowerCase()
}

type TabKey = 'changes' | 'editor' | 'preview' | 'file'

function useOwnFileData(filePath: string | undefined, refreshKey: number) {
  const fileRoot = useEffectiveProjectRoot()
  const [diff, setDiff] = useState<GitFileDiff | null>(null)
  const [content, setContent] = useState<GitFileContent | null>(null)
  const [tab, setTab] = useState<TabKey>('file')
  const pickedTabForPathRef = useRef<string | null>(null)

  useEffect(() => {
    if (!filePath || !fileRoot) return
    let cancelled = false
    Promise.all([
      window.app.getGitDiffFile(fileRoot, filePath, false),
      window.app.readProjectFile(fileRoot, filePath),
    ]).then(([d, c]) => {
      if (cancelled) return
      setDiff(d)
      setContent(c)
      // A failed read carries no language signal — leave the tab unpicked so a
      // successful retry still derives the right default (Preview for markdown).
      if (c.error) return
      if (pickedTabForPathRef.current === filePath) return
      pickedTabForPathRef.current = filePath
      const isBin = c.language === 'image' || c.language === 'pdf' || c.language === 'video' || c.language === 'audio'
      const isSvg = c.language === 'svg'
      const ext = getFileExt(filePath)
      const isMd = MARKDOWN_EXTS.has(ext)
      const isNb = NOTEBOOK_EXTS.has(ext)
      // Default: media + markdown + notebook → Preview; dirty git → Changes; else File.
      setTab(
        isBin || isSvg || isMd || isNb
          ? 'preview'
          : d.diff
            ? 'changes'
            : 'file',
      )
    }).catch(() => {
      if (!cancelled && pickedTabForPathRef.current !== filePath) { setDiff(null); setContent(null) }
    })
    return () => { cancelled = true }
  }, [filePath, fileRoot, refreshKey])

  return { diff, content, tab, setTab }
}

interface FilePreviewProps {
  filePath: string
}

export function FilePreview({ filePath }: FilePreviewProps) {
  const { t } = useTranslation()
  const fileRoot = useEffectiveProjectRoot()
  const [isDirty, setIsDirty] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [retrying, setRetrying] = useState(false)
  const liveContentRef = useRef<string | null>(null)
  const { diff: fileDiff, content: fileContent, tab: activeTab, setTab: setActiveTab } = useOwnFileData(filePath, refreshKey)
  const selectedFile = filePath
  // A failed read yields empty content — without this the preview would render
  // a blank editor, indistinguishable from an empty file.
  const loadError = fileContent?.error
  useEffect(() => { setRetrying(false) }, [fileContent])
  const handleRetry = useCallback(() => {
    setRetrying(true)
    setRefreshKey((k) => k + 1)
  }, [])

  const fileName = selectedFile?.split('/').pop() ?? ''
  const ext = getFileExt(fileName)
  const isMd = MARKDOWN_EXTS.has(ext)
  const isNotebook = NOTEBOOK_EXTS.has(ext)
  const isBinImg = BINARY_IMAGE_EXTS.has(ext)
  const isPdfFile = PDF_EXTS.has(ext)
  const isSvgFile = ext === '.svg'
  const isVideoFile = VIDEO_EXTS.has(ext)
  const isAudioFile = AUDIO_EXTS.has(ext)
  const hasDiff = !!fileDiff?.diff
  const isBinaryPreview = isBinImg || isPdfFile || isVideoFile || isAudioFile
  const isUnpreviewable = fileContent?.language === 'binary' || fileContent?.language === 'too-large'
  // Non-md text files still use Editor + File; markdown and notebooks use
  // Preview + File only (a notebook's raw JSON is not hand-editable safely).
  const isTextEditable = !isBinaryPreview && !isUnpreviewable && !isSvgFile && !isMd && !isNotebook
  const fullFilePath = isAbsoluteLocalPath(selectedFile) ? selectedFile : `${fileRoot}/${selectedFile}`

  const tabs = (() => {
    if (loadError || isUnpreviewable) return []
    if (isBinaryPreview) return [{ key: 'preview' as TabKey, label: 'Preview' }]
    const items: { key: TabKey; label: string }[] = []
    if (hasDiff) items.push({ key: 'changes', label: 'Changes' })
    if (isSvgFile || isMd || isNotebook) items.push({ key: 'preview', label: 'Preview' })
    if (isTextEditable) items.push({ key: 'editor', label: 'Editor' })
    items.push({ key: 'file', label: 'File' })
    return items
  })()

  const effectiveTab = tabs.find((t) => t.key === activeTab) ? activeTab : tabs[0]?.key ?? 'file'
  const handleTabChange = useCallback((v: string) => {
    setActiveTab(v as TabKey)
  }, [setActiveTab])

  const reportUnsaved = useCallback((text: string | null) => {
    if (!fullFilePath) return
    void window.app.setUnsavedEditorBuffer?.(fullFilePath, text)
  }, [fullFilePath])

  const handleDirtyChange = useCallback((dirty: boolean) => {
    setIsDirty(dirty)
    if (!dirty) {
      reportUnsaved(null)
    } else if (liveContentRef.current != null) {
      reportUnsaved(liveContentRef.current)
    }
  }, [reportUnsaved])

  const handleContentChange = useCallback((text: string) => {
    liveContentRef.current = text
    // Only publish draft while content differs from last loaded disk snapshot.
    const disk = fileContent?.content ?? ''
    if (text !== disk) {
      reportUnsaved(text)
    } else {
      reportUnsaved(null)
    }
  }, [fileContent?.content, reportUnsaved])

  useEffect(() => {
    return () => {
      reportUnsaved(null)
    }
  }, [reportUnsaved])

  const handleSaved = useCallback(() => {
    reportUnsaved(null)
    setRefreshKey((k) => k + 1)
  }, [reportUnsaved])

  const rootRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  useEffect(() => {
    return window.app.onContentZoom((action) => {
      if (!rootRef.current?.matches(':hover')) return
      if (action === 'reset') setZoom(1)
      else if (action === 'in') setZoom((v) => Math.min(v + 0.05, 1.5))
      else setZoom((v) => Math.max(v - 0.05, 0.5))
    })
  }, [])

  if (!selectedFile) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <FileX2 className="size-8 opacity-30" />
        <span className="text-xs">Select a file from Files</span>
      </div>
    )
  }

  // Keep leading root "/" as a segment; drop empty pieces from split.
  const pathSegments = selectedFile.split(/[/\\]/).filter((s, i) => s.length > 0 || i === 0)
  const breadcrumbRef = useRef<HTMLDivElement>(null)
  // Prefer showing the filename when the path overflows — scroll to the end.
  useEffect(() => {
    const el = breadcrumbRef.current
    if (!el) return
    el.scrollLeft = el.scrollWidth
  }, [selectedFile, pathSegments.length])

  // Prefer in-memory draft when remounting markdown Preview so edits aren't lost.
  const editorContent = liveContentRef.current ?? fileContent?.content ?? ''
  const textEditorBody = (
    <TextFileEditor
      content={editorContent}
      filePath={selectedFile}
      onDirtyChange={handleDirtyChange}
      onContentChange={handleContentChange}
      onSaved={handleSaved}
    />
  )
  const markdownPreviewBody = (
    <MarkdownEditor
      content={editorContent}
      filePath={selectedFile}
      onDirtyChange={handleDirtyChange}
      onContentChange={handleContentChange}
      onSaved={handleSaved}
    />
  )

  return (
    <div ref={rootRef} className="flex h-full flex-col">
      <div className="flex h-8 shrink-0 items-center gap-1 px-2">
        <div
          ref={breadcrumbRef}
          title={selectedFile}
          className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto overflow-y-hidden hide-scrollbar"
        >
          {pathSegments.map((segment, i) => (
            <span key={i} className="flex shrink-0 items-center gap-0.5">
              {i > 0 && <ChevronRight className="size-3 shrink-0 text-muted-foreground/50" />}
              {i === pathSegments.length - 1 ? (
                <span className="flex items-center gap-1">
                  <FileIcon name={segment || selectedFile} size={13} className="shrink-0" />
                  <span className="text-xs font-medium whitespace-nowrap">{segment || selectedFile}</span>
                </span>
              ) : (
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {segment || '/'}
                </span>
              )}
            </span>
          ))}
        </div>
        {isDirty && <span className="size-1.5 rounded-full bg-orange-600 dark:bg-orange-400" title={t('tooltips.unsavedChanges')} />}
        {tabs.length > 1 && (
          <Tabs value={effectiveTab} onValueChange={handleTabChange}>
            <TabsList>
              {tabs.map((tab) => (
                <TabsTrigger key={tab.key} value={tab.key} className="text-[10px]">
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto" style={zoom !== 1 ? { zoom } : undefined}>
        {loadError ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <FileX2 className="size-8 opacity-30" />
            <span className="text-xs">{t('filePreview.loadFailed')}</span>
            <span className="max-w-[36ch] text-center text-[11px] opacity-70">{t('filePreview.loadFailedHint')}</span>
            <span className="max-w-[48ch] truncate font-mono text-[10px] opacity-60" title={loadError}>{loadError}</span>
            <Button variant="outline" size="sm" onClick={handleRetry} disabled={retrying} className="mt-1">
              <RefreshCw className={cn('size-3', retrying && 'animate-spin')} />
              {t('common.retry')}
            </Button>
          </div>
        ) : isUnpreviewable ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <FileX2 className="size-8 opacity-30" />
            <span className="text-xs">
              {fileContent?.language === 'too-large' ? t('filePreview.tooLarge') : t('filePreview.binary')}
            </span>
          </div>
        ) : (
          <>
            {/* Markdown: Preview = editable WYSIWYG. File uses the same highlighted
                source view as other files (FileWithDiffView). Editable highlighted
                File for all types is a later unification. */}
            {isMd && effectiveTab === 'preview' && (
              <FileSelectionContextMenuZone
                filePath={fullFilePath}
                fileContent={editorContent}
                className="size-full"
              >
                {markdownPreviewBody}
              </FileSelectionContextMenuZone>
            )}
            {/* Non-markdown text: Editor tab = plain editable textarea. */}
            {isTextEditable && (
              <FileSelectionContextMenuZone
                filePath={fullFilePath}
                fileContent={liveContentRef.current ?? fileContent?.content ?? null}
                className={effectiveTab === 'editor' ? 'size-full' : 'hidden'}
              >
                {textEditorBody}
              </FileSelectionContextMenuZone>
            )}
            {effectiveTab === 'changes' && hasDiff ? (
              <FileSelectionContextMenuZone filePath={fullFilePath} fileContent={fileContent?.content ?? null} className="size-full">
                <FileDiffView filePath={selectedFile} diff={fileDiff?.diff ?? ''} content={fileContent?.content ?? ''} />
              </FileSelectionContextMenuZone>
            ) : effectiveTab === 'preview' && isNotebook ? (
              <FileSelectionContextMenuZone filePath={fullFilePath} fileContent={fileContent?.content ?? null} className="size-full">
                <NotebookPreview content={fileContent?.content ?? ''} />
              </FileSelectionContextMenuZone>
            ) : effectiveTab === 'preview' && isBinImg ? (
              <ImagePreview
                src={previewSrc(fileContent?.content, () => toLocalFileUrl(fullFilePath))}
                alt={fileName}
              />
            ) : effectiveTab === 'preview' && isPdfFile ? (
              <PdfPreview
                url={previewSrc(fileContent?.content, () => toLocalFileUrl(fullFilePath))}
                className="h-full"
              />
            ) : effectiveTab === 'preview' && isVideoFile ? (
              <div className="flex h-full items-center justify-center p-4">
                <video
                  src={previewSrc(fileContent?.content, () => toMediaUrl(fullFilePath), toMediaUrl)}
                  controls
                  preload="auto"
                  className="max-h-full max-w-full"
                />
              </div>
            ) : effectiveTab === 'preview' && isAudioFile ? (
              <div className="flex h-full items-center justify-center p-4">
                <audio
                  src={previewSrc(fileContent?.content, () => toMediaUrl(fullFilePath), toMediaUrl)}
                  controls
                  preload="auto"
                />
              </div>
            ) : effectiveTab === 'preview' && isSvgFile ? (
              <ImagePreview
                src={
                  fileContent?.content
                    ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(fileContent.content)}`
                    : toLocalFileUrl(fullFilePath)
                }
                alt={fileName}
              />
            ) : effectiveTab === 'file' ? (
              <FileSelectionContextMenuZone filePath={fullFilePath} fileContent={fileContent?.content ?? null} className="size-full">
                <FileWithDiffView filePath={selectedFile} content={fileContent?.content ?? ''} diff={fileDiff?.diff ?? ''} />
              </FileSelectionContextMenuZone>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}
