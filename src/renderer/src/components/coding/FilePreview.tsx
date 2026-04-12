import { useCallback, useMemo, useRef, useState, useEffect } from 'react'
import { FileX2, ChevronRight } from 'lucide-react'
import { defaultRehypePlugins } from 'streamdown'
import { FileIcon } from '@/components/ui/FileIcon'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAppStore } from '@/stores/app'
import { toLocalFileUrl, toMediaUrl } from '@/lib/path-utils'
import { MarkdownView } from '@/components/MarkdownPreview'
import { PdfPreview } from '@/components/chat/PdfPreview'
import type { GitFileDiff, GitFileContent } from '../../../../shared/agent-types'
import { FileDiffView } from './source-control/FileDiffView'
import { FileWithDiffView } from './source-control/FileWithDiffView'
import { ImagePreview } from './ImagePreview'
import { MarkdownEditor } from './MarkdownEditor'

const MARKDOWN_EXTS = new Set(['md', 'mdx', 'markdown'])
const BINARY_IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico'])
const PDF_EXTS = new Set(['pdf'])
const VIDEO_EXTS = new Set(['mp4', 'webm', 'ogg', 'mov'])
const AUDIO_EXTS = new Set(['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg'])

function getFileExt(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() ?? ''
}

type TabKey = 'changes' | 'file' | 'preview'

function useOwnFileData(filePath: string | undefined) {
  const currentFolder = useAppStore((s) => s.currentFolder)
  const [diff, setDiff] = useState<GitFileDiff | null>(null)
  const [content, setContent] = useState<GitFileContent | null>(null)
  const [tab, setTab] = useState<TabKey>('file')

  useEffect(() => {
    if (!filePath || !currentFolder) return
    let cancelled = false
    Promise.all([
      window.app.getGitDiffFile(currentFolder, filePath, false),
      window.app.getGitReadFile(currentFolder, filePath),
    ]).then(([d, c]) => {
      if (cancelled) return
      setDiff(d)
      setContent(c)
      const isBin = c.language === 'image' || c.language === 'pdf' || c.language === 'video' || c.language === 'audio'
      const isSvg = c.language === 'svg'
      setTab(isBin ? 'preview' : d.diff ? 'changes' : isSvg ? 'preview' : 'file')
    }).catch(() => {
      if (!cancelled) { setDiff(null); setContent(null) }
    })
    return () => { cancelled = true }
  }, [filePath, currentFolder])

  return { diff, content, tab, setTab }
}

interface FilePreviewProps {
  filePath: string
}

export function FilePreview({ filePath }: FilePreviewProps) {
  const currentFolder = useAppStore((s) => s.currentFolder)
  const [isDirty, setIsDirty] = useState(false)
  const [liveContent, setLiveContent] = useState<string | null>(null)
  const liveContentRef = useRef<string | null>(null)
  const { diff: fileDiff, content: fileContent, tab: activeTab, setTab: setActiveTab } = useOwnFileData(filePath)
  const selectedFile = filePath

  const fileName = selectedFile?.split('/').pop() ?? ''
  const ext = getFileExt(fileName)
  const isMd = MARKDOWN_EXTS.has(ext)
  const isBinImg = BINARY_IMAGE_EXTS.has(ext)
  const isPdfFile = PDF_EXTS.has(ext)
  const isSvgFile = ext === 'svg'
  const isVideoFile = VIDEO_EXTS.has(ext)
  const isAudioFile = AUDIO_EXTS.has(ext)
  const hasDiff = !!fileDiff?.diff
  const isBinaryPreview = isBinImg || isPdfFile || isVideoFile || isAudioFile
  const fullFilePath = selectedFile.startsWith('/') ? selectedFile : `${currentFolder}/${selectedFile}`

  const resolvedContent = useMemo(() => {
    const raw = (isMd ? liveContent : null) ?? fileContent?.content ?? ''
    if (!currentFolder || !selectedFile) return raw
    const dir = selectedFile.includes('/') ? selectedFile.substring(0, selectedFile.lastIndexOf('/')) : ''
    const baseDir = currentFolder + (dir ? '/' + dir : '')
    return raw.replace(
      /!\[([^\]]*)\]\((?!https?:\/\/|data:|local-file:\/\/)([^)\s]+)([^)]*)\)/g,
      (_, alt, src, rest) => {
        const cleanSrc = src.replace(/^\.\//, '')
        const resolved = src.startsWith('/')
          ? toLocalFileUrl(src)
          : toLocalFileUrl(`${baseDir}/${cleanSrc}`)
        return `![${alt}](${resolved}${rest})`
      },
    )
  }, [currentFolder, selectedFile, fileContent?.content, liveContent, isMd])

  const previewRehypePlugins = useMemo(() => [defaultRehypePlugins.raw], [])

  const tabs = useMemo(() => {
    if (isBinaryPreview) return [{ key: 'preview' as TabKey, label: 'Preview' }]
    const t: { key: TabKey; label: string }[] = []
    if (hasDiff) t.push({ key: 'changes', label: 'Changes' })
    t.push({ key: 'file', label: 'File' })
    if (isMd || isSvgFile) t.push({ key: 'preview', label: 'Preview' })
    return t
  }, [hasDiff, isMd, isBinaryPreview, isSvgFile])

  const effectiveTab = tabs.find((t) => t.key === activeTab) ? activeTab : tabs[0]?.key ?? 'file'
  const handleTabChange = useCallback((v: string) => {
    if (v !== 'file' && liveContentRef.current !== null) {
      setLiveContent(liveContentRef.current)
    }
    setActiveTab(v as TabKey)
  }, [setActiveTab])

  const handleDirtyChange = useCallback((dirty: boolean) => setIsDirty(dirty), [])
  const handleContentChange = useCallback((text: string) => { liveContentRef.current = text }, [])

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
        {isDirty && <span className="size-1.5 rounded-full bg-orange-400" title="Unsaved changes" />}
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
        {isMd && (
          <div className={effectiveTab === 'file' ? 'size-full' : 'hidden'}>
            <MarkdownEditor content={fileContent?.content ?? ''} filePath={selectedFile} onDirtyChange={handleDirtyChange} onContentChange={handleContentChange} />
          </div>
        )}
        {effectiveTab === 'changes' && hasDiff ? (
          <FileDiffView filePath={selectedFile} diff={fileDiff?.diff ?? ''} />
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
        ) : effectiveTab === 'preview' && isMd ? (
          <MarkdownView content={resolvedContent} rehypePlugins={previewRehypePlugins} />
        ) : !isMd ? (
          <FileWithDiffView filePath={selectedFile} content={fileContent?.content ?? ''} diff={fileDiff?.diff ?? ''} />
        ) : null}
      </div>
    </div>
  )
}
