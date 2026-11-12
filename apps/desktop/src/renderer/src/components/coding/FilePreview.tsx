import { lazy, Suspense, useCallback, useRef, useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { FileX2, ChevronRight, RefreshCw } from 'lucide-react'
import { FileIcon } from '@superone/ui/components/ui/FileIcon'
import { Button } from '@superone/ui/components/ui/button'
import { cn } from '@superone/ui/lib/utils'
import { Tabs, TabsList, TabsTrigger } from '@superone/ui/components/ui/tabs'
import type { GitFileDiff, GitFileContent } from '@superone/shared/agent-types'
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
import { useEffectiveProjectRoot } from '@/stores/app'
import { useSourceControlStore } from '@/stores/source-control'
import { isAbsoluteLocalPath } from '@/lib/file-link'
import { parseRemoteProjectKey } from '@/lib/remote-project-key'
import { absoluteFilePath } from '@/components/chat/file-chip-context-menu'
import { ImageContextMenu } from '@/components/chat/image-shared'
import { PdfPreview } from '@/components/chat/PdfPreview'
import { McpAppOpenWithActions, McpAppOpenWithButton } from '@/components/mcp-apps/McpAppOpenWith'
import { lastTouchedPane } from '@/stores/chat-store/session-scope'
import { localFileUrlToPath, toLocalFileUrl, toMediaUrl } from '@/lib/path-utils'
import { resolveMediaSrcForProject } from '@/lib/remote-media-url'
import { MarkdownAudioPlayer, MarkdownVideoPlayer } from '@/components/chat/markdown-media-player'
import type { ModelPreviewViewState } from './ModelPreview'
import { OfficePreview } from './OfficePreview'
import { OfficePreviewStatus } from './office-toolbar'
import { ImagePreview } from './ImagePreview'
import { MarkdownEditor } from './MarkdownEditor'
import { NotebookPreview } from './NotebookPreview'
import { FileSelectionContextMenuZone } from './FileSelectionContextMenuZone'

const ModelPreview = lazy(() => import('./ModelPreview').then((module) => ({ default: module.ModelPreview })))
const CodeFileEditor = lazy(() => import('./CodeFileEditor').then((module) => ({ default: module.CodeFileEditor })))

function previewSrc(content: string | undefined, fromPath: () => string, stream?: (path: string) => string): string {
  if (!content) return fromPath()
  if (content.startsWith('data:')) return content
  const mirror = localFileUrlToPath(content)
  if (mirror) return stream ? stream(mirror) : content
  return fromPath()
}

export function imageActionPath(fullFilePath: string, content: string | undefined, remote: boolean): string | null {
  const mirrored = content ? localFileUrlToPath(content) : null
  if (mirrored) return mirrored
  if (remote) return null
  return isAbsoluteLocalPath(fullFilePath) ? fullFilePath : null
}

function withImageMenu(path: string | null, child: React.ReactNode) {
  if (!path) return child
  return <ImageContextMenu savedPath={path} className="size-full">{child}</ImageContextMenu>
}

function getFileExt(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot < 0 ? '' : fileName.slice(dot).toLowerCase()
}

type TabKey = 'preview' | 'file'

function useOwnFileData(filePath: string | undefined, refreshKey: number, root?: string) {
  const projectRoot = useEffectiveProjectRoot()
  const fileRoot = root ?? projectRoot
  const targetKey = `${fileRoot ?? ''}::${filePath ?? ''}`
  const [loaded, setLoaded] = useState<{ key: string; diff: GitFileDiff | null; content: GitFileContent | null }>({
    key: '',
    diff: null,
    content: null,
  })
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
      setLoaded({ key: targetKey, diff: d, content: c })
      if (c.error) return
      if (pickedTabForPathRef.current === targetKey) return
      pickedTabForPathRef.current = targetKey
      const isBin =
        c.language === 'image' ||
        c.language === 'pdf' ||
        c.language === 'video' ||
        c.language === 'audio' ||
        c.language === 'model' ||
        c.language === 'office'
      const isSvg = c.language === 'svg'
      const ext = getFileExt(filePath)
      const isMd = MARKDOWN_EXTENSIONS.has(ext)
      const isNb = NOTEBOOK_EXTENSIONS.has(ext)
      setTab(isBin || isSvg || isMd || isNb ? 'preview' : 'file')
    }).catch(() => {
      if (!cancelled && pickedTabForPathRef.current !== targetKey) {
        setLoaded({ key: targetKey, diff: null, content: null })
      }
    })
    return () => { cancelled = true }
  }, [filePath, fileRoot, refreshKey, targetKey])

  const isCurrent = loaded.key === targetKey
  return { diff: isCurrent ? loaded.diff : null, content: isCurrent ? loaded.content : null, tab, setTab }
}

interface FilePreviewProps {
  filePath: string
  fileRoot?: string
}

export function FilePreview({ filePath, fileRoot: root }: FilePreviewProps) {
  const { t } = useTranslation()
  const projectRoot = useEffectiveProjectRoot()
  const fileRoot = root ?? projectRoot
  const [isDirty, setIsDirty] = useState(false)
  const isDirtyRef = useRef(false)
  const [draftContent, setDraftContent] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [retrying, setRetrying] = useState(false)
  const [modelViewState, setModelViewState] = useState<ModelPreviewViewState | null>(null)
  const liveContentRef = useRef<string | null>(null)
  const { diff: fileDiff, content: fileContent, tab: activeTab, setTab: setActiveTab } = useOwnFileData(filePath, refreshKey, root)
  const scrollToLine = useSourceControlStore((s) => s.scrollToLine)
  const selectedSourceFile = useSourceControlStore((s) => s.selectedFile)
  const selectedFile = filePath
  const loadError = fileContent?.error

  useEffect(() => { setRetrying(false) }, [fileContent])
  useEffect(() => {
    setIsDirty(false)
    isDirtyRef.current = false
    setDraftContent(null)
    liveContentRef.current = null
  }, [filePath])

  useEffect(() => {
    if (scrollToLine && selectedSourceFile === filePath) {
      setActiveTab('file')
    }
  }, [scrollToLine, selectedSourceFile, filePath, setActiveTab])

  useEffect(() => {
    if (!fileRoot) return
    const onFileChange = window.app.onFileChangeEvent
    const onHeadChange = window.app.onGitHeadChange
    if (!onFileChange && !onHeadChange) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        if (!isDirtyRef.current) setRefreshKey((k) => k + 1)
      }, 300)
    }
    const unsubFile = onFileChange?.(schedule)
    const unsubHead = onHeadChange?.(schedule)
    return () => {
      clearTimeout(timer)
      unsubFile?.()
      unsubHead?.()
    }
  }, [fileRoot])

  const handleRetry = useCallback(() => {
    setRetrying(true)
    setRefreshKey((k) => k + 1)
  }, [])

  const fileName = selectedFile?.split('/').pop() ?? ''
  const ext = getFileExt(fileName)
  const isMd = MARKDOWN_EXTENSIONS.has(ext)
  const isNotebook = NOTEBOOK_EXTENSIONS.has(ext)
  const isBinImg = BINARY_IMAGE_EXTENSIONS.has(ext)
  const isPdfFile = PDF_EXTENSIONS.has(ext)
  const isSvgFile = ext === '.svg'
  const isVideoFile = VIDEO_EXTENSIONS.has(ext)
  const isAudioFile = AUDIO_EXTENSIONS.has(ext)
  const isModelFile = MODEL_EXTENSIONS.has(ext)
  const officeKind = officePreviewKind(fileName)
  const isOfficeFile = officeKind !== null
  const isBinaryPreview = isBinImg || isPdfFile || isVideoFile || isAudioFile || isModelFile || isOfficeFile
  const isUnpreviewable = fileContent?.language === 'binary' || fileContent?.language === 'too-large'
  const fullFilePath = isAbsoluteLocalPath(selectedFile) ? selectedFile : `${fileRoot}/${selectedFile}`
  const imagePath = imageActionPath(fullFilePath, fileContent?.content, !!parseRemoteProjectKey(fileRoot ?? ''))

  useEffect(() => { setModelViewState(null) }, [fullFilePath])

  const tabs = (() => {
    if (loadError || isUnpreviewable) return []
    if (isBinaryPreview) return [{ key: 'preview' as TabKey, label: 'Preview' }]
    const items: { key: TabKey; label: string }[] = []
    if (isSvgFile || isMd || isNotebook) items.push({ key: 'preview', label: 'Preview' })
    items.push({ key: 'file', label: 'File' })
    return items
  })()

  const effectiveTab = tabs.find((item) => item.key === activeTab) ? activeTab : tabs[0]?.key ?? 'file'
  const handleTabChange = useCallback((v: string) => {
    setActiveTab(v as TabKey)
  }, [setActiveTab])

  const reportUnsaved = useCallback((text: string | null) => {
    if (!fullFilePath) return
    void window.app.setUnsavedEditorBuffer?.(fullFilePath, text)
  }, [fullFilePath])

  const handleDirtyChange = useCallback((dirty: boolean) => {
    setIsDirty(dirty)
    isDirtyRef.current = dirty
    if (!dirty) {
      reportUnsaved(null)
    } else if (liveContentRef.current != null) {
      reportUnsaved(liveContentRef.current)
    }
  }, [reportUnsaved])

  const handleContentChange = useCallback((text: string) => {
    liveContentRef.current = text
    setDraftContent(text)
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

  const handleSaved = useCallback((savedText?: string) => {
    if (savedText !== undefined) {
      liveContentRef.current = savedText
      setDraftContent(savedText)
    }
    isDirtyRef.current = false
    setIsDirty(false)
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

  const pathSegments = selectedFile.split(/[/\\]/).filter((s, i) => s.length > 0 || i === 0)
  const breadcrumbRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = breadcrumbRef.current
    if (!el) return
    el.scrollLeft = el.scrollWidth
  }, [selectedFile, pathSegments.length])

  const editorContent = draftContent ?? fileContent?.content ?? ''

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
        {!loadError && !isUnpreviewable && <McpAppOpenWithButton absolutePath={absoluteFilePath(selectedFile, fileRoot)} scope={lastTouchedPane()} />}
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
            <McpAppOpenWithActions absolutePath={absoluteFilePath(selectedFile, fileRoot)} scope={lastTouchedPane()} />
          </div>
        ) : (
          <>
            {isMd && effectiveTab === 'preview' ? (
              <FileSelectionContextMenuZone
                filePath={fullFilePath}
                fileContent={editorContent}
                className="size-full"
              >
                <MarkdownEditor
                  content={editorContent}
                  filePath={selectedFile}
                  onDirtyChange={handleDirtyChange}
                  onContentChange={handleContentChange}
                  onSaved={handleSaved}
                />
              </FileSelectionContextMenuZone>
            ) : effectiveTab === 'preview' && isNotebook ? (
              <FileSelectionContextMenuZone filePath={fullFilePath} fileContent={editorContent} className="size-full">
                <NotebookPreview content={editorContent} />
              </FileSelectionContextMenuZone>
            ) : effectiveTab === 'preview' && isBinImg ? (
              withImageMenu(imagePath, (
                <ImagePreview
                  src={previewSrc(fileContent?.content, () => toLocalFileUrl(fullFilePath))}
                  alt={fileName}
                />
              ))
            ) : effectiveTab === 'preview' && isPdfFile ? (
              <PdfPreview
                url={previewSrc(fileContent?.content, () => toLocalFileUrl(fullFilePath))}
                className="h-full"
              />
            ) : effectiveTab === 'preview' && isOfficeFile && fileContent?.language === 'office' ? (
              <div className="h-full min-h-0 overflow-hidden">
                <OfficePreview
                  url={previewSrc(fileContent.content, () => toLocalFileUrl(fullFilePath))}
                  name={fileName}
                />
              </div>
            ) : effectiveTab === 'preview' && isOfficeFile ? (
              fileContent ? null : <OfficePreviewStatus phase="loading" />
            ) : effectiveTab === 'preview' && isVideoFile ? (
              <div className="flex h-full items-center justify-center p-4">
                <MarkdownVideoPlayer
                  src={previewSrc(fileContent?.content, () => toMediaUrl(fullFilePath), toMediaUrl)}
                  preload="auto"
                  fitToContainer
                />
              </div>
            ) : effectiveTab === 'preview' && isAudioFile ? (
              <div className="flex h-full items-center justify-center p-4">
                <MarkdownAudioPlayer
                  src={previewSrc(fileContent?.content, () => toMediaUrl(fullFilePath), toMediaUrl)}
                  source={resolveMediaSrcForProject(fullFilePath, fileRoot ?? '')}
                  preload="auto"
                />
              </div>
            ) : effectiveTab === 'preview' && isModelFile ? (
              <Suspense fallback={<div className="size-full" />}>
                <ModelPreview
                  src={previewSrc(fileContent?.content, () => toMediaUrl(fullFilePath), toMediaUrl)}
                  name={fileName}
                  initialViewState={modelViewState}
                  onViewStateChange={setModelViewState}
                />
              </Suspense>
            ) : effectiveTab === 'preview' && isSvgFile ? (
              withImageMenu(imagePath, (
                <ImagePreview
                  src={
                    editorContent
                      ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(editorContent)}`
                      : toLocalFileUrl(fullFilePath)
                  }
                  alt={fileName}
                />
              ))
            ) : effectiveTab === 'file' && fileContent !== null ? (
              <Suspense fallback={<div className="size-full" />}>
                <CodeFileEditor
                  key={`${fileRoot ?? ''}::${selectedFile}`}
                  content={editorContent}
                  diskContent={fileContent.content ?? ''}
                  gitDiff={fileDiff?.diff ?? ''}
                  filePath={selectedFile}
                  fileRoot={fileRoot}
                  onDirtyChange={handleDirtyChange}
                  onContentChange={handleContentChange}
                  onSaved={handleSaved}
                />
              </Suspense>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}
