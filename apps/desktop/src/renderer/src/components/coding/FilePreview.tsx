import { useCallback, useRef, useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { FileX2, ChevronRight } from 'lucide-react'
import { FileIcon } from '@superone/ui/components/ui/FileIcon'
import { Tabs, TabsList, TabsTrigger } from '@superone/ui/components/ui/tabs'
import { useEffectiveProjectRoot } from '@/stores/app'
import { toLocalFileUrl, toMediaUrl } from '@/lib/path-utils'
import { PdfPreview } from '@/components/chat/PdfPreview'
import type { GitFileDiff, GitFileContent } from '@superone/shared/agent-types'
import { FileDiffView } from './source-control/FileDiffView'
import { FileWithDiffView } from './source-control/FileWithDiffView'
import { ImagePreview } from './ImagePreview'
import { MarkdownEditor } from './MarkdownEditor'
import { HtmlPreview } from './HtmlPreview'
import { FileSelectionContextMenuZone } from './FileSelectionContextMenuZone'

const MARKDOWN_EXTS = new Set(['md', 'mdx', 'markdown'])
const BINARY_IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico'])
const PDF_EXTS = new Set(['pdf'])
const VIDEO_EXTS = new Set(['mp4', 'webm', 'ogg', 'mov'])
const AUDIO_EXTS = new Set(['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg'])
const HTML_EXTS = new Set(['html', 'htm'])

function getFileExt(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() ?? ''
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
      if (pickedTabForPathRef.current === filePath) return
      pickedTabForPathRef.current = filePath
      const isBin = c.language === 'image' || c.language === 'pdf' || c.language === 'video' || c.language === 'audio'
      const isSvg = c.language === 'svg'
      const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
      const isHtml = HTML_EXTS.has(ext)
      const isMd = MARKDOWN_EXTS.has(ext)
      setTab(isBin || isSvg || isHtml ? 'preview' : d.diff ? 'changes' : isMd ? 'editor' : 'file')
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
  const liveContentRef = useRef<string | null>(null)
  const { diff: fileDiff, content: fileContent, tab: activeTab, setTab: setActiveTab } = useOwnFileData(filePath, refreshKey)
  const selectedFile = filePath

  const fileName = selectedFile?.split('/').pop() ?? ''
  const ext = getFileExt(fileName)
  const isMd = MARKDOWN_EXTS.has(ext)
  const isBinImg = BINARY_IMAGE_EXTS.has(ext)
  const isPdfFile = PDF_EXTS.has(ext)
  const isSvgFile = ext === 'svg'
  const isVideoFile = VIDEO_EXTS.has(ext)
  const isAudioFile = AUDIO_EXTS.has(ext)
  const isHtml = HTML_EXTS.has(ext)
  const hasDiff = !!fileDiff?.diff
  const isBinaryPreview = isBinImg || isPdfFile || isVideoFile || isAudioFile
  const isUnpreviewable = fileContent?.language === 'binary' || fileContent?.language === 'too-large'
  const fullFilePath = selectedFile.startsWith('/') ? selectedFile : `${fileRoot}/${selectedFile}`

  const tabs = (() => {
    if (isUnpreviewable) return []
    if (isBinaryPreview) return [{ key: 'preview' as TabKey, label: 'Preview' }]
    const items: { key: TabKey; label: string }[] = []
    if (hasDiff) items.push({ key: 'changes', label: 'Changes' })
    if (isSvgFile || isHtml) items.push({ key: 'preview', label: 'Preview' })
    if (isMd) items.push({ key: 'editor', label: 'Editor' })
    items.push({ key: 'file', label: 'File' })
    return items
  })()

  const effectiveTab = tabs.find((t) => t.key === activeTab) ? activeTab : tabs[0]?.key ?? 'file'
  const handleTabChange = useCallback((v: string) => {
    setActiveTab(v as TabKey)
  }, [setActiveTab])

  const handleDirtyChange = useCallback((dirty: boolean) => setIsDirty(dirty), [])
  const handleContentChange = useCallback((text: string) => { liveContentRef.current = text }, [])
  const handleSaved = useCallback(() => setRefreshKey((k) => k + 1), [])

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

  const pathSegments = selectedFile.split('/')

  return (
    <div ref={rootRef} className="flex h-full flex-col">
      <div className="flex h-8 shrink-0 items-center gap-1 px-2">
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
          {pathSegments.map((segment, i) => (
            <span key={i} className="flex shrink-0 items-center gap-0.5">
              {i > 0 && <ChevronRight className="size-3 shrink-0 text-muted-foreground/50" />}
              {i === pathSegments.length - 1 ? (
                <span className="flex items-center gap-1 truncate">
                  <FileIcon name={segment} size={13} className="shrink-0" />
                  <span className="truncate text-xs font-medium">{segment}</span>
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">{segment}</span>
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
        {isUnpreviewable ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <FileX2 className="size-8 opacity-30" />
            <span className="text-xs">
              {fileContent?.language === 'too-large' ? 'File too large to preview' : 'Binary file — preview not supported'}
            </span>
          </div>
        ) : (
          <>
            {isMd && (
              <FileSelectionContextMenuZone
                filePath={fullFilePath}
                fileContent={fileContent?.content ?? null}
                className={effectiveTab === 'editor' ? 'size-full' : 'hidden'}
              >
                <MarkdownEditor content={fileContent?.content ?? ''} filePath={selectedFile} onDirtyChange={handleDirtyChange} onContentChange={handleContentChange} onSaved={handleSaved} />
              </FileSelectionContextMenuZone>
            )}
            {effectiveTab === 'changes' && hasDiff ? (
              <FileSelectionContextMenuZone filePath={fullFilePath} fileContent={fileContent?.content ?? null} className="size-full">
                <FileDiffView filePath={selectedFile} diff={fileDiff?.diff ?? ''} content={fileContent?.content ?? ''} />
              </FileSelectionContextMenuZone>
            ) : effectiveTab === 'preview' && isBinImg ? (
              <ImagePreview src={toLocalFileUrl(fullFilePath)} alt={fileName} />
            ) : effectiveTab === 'preview' && isPdfFile ? (
              <PdfPreview url={toLocalFileUrl(fullFilePath)} className="h-full" />
            ) : effectiveTab === 'preview' && isVideoFile ? (
              <div className="flex h-full items-center justify-center p-4">
                <video src={toMediaUrl(fullFilePath)} controls preload="auto" className="max-h-full max-w-full" />
              </div>
            ) : effectiveTab === 'preview' && isAudioFile ? (
              <div className="flex h-full items-center justify-center p-4">
                <audio src={toMediaUrl(fullFilePath)} controls preload="auto" />
              </div>
            ) : effectiveTab === 'preview' && isSvgFile ? (
              <ImagePreview src={toLocalFileUrl(fullFilePath)} alt={fileName} />
            ) : effectiveTab === 'preview' && isHtml ? (
              <HtmlPreview src={toLocalFileUrl(fullFilePath)} />
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
