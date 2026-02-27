import { useCallback, useMemo } from 'react'
import { X, FileX2, PanelLeft } from 'lucide-react'
import { Streamdown, defaultRehypePlugins } from 'streamdown'
import { FileIcon } from '@/components/ui/FileIcon'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { CommandShortcut } from '@/components/ui/command'
import { useAppStore } from '@/stores/app'
import { useSourceControlStore } from '@/stores/source-control'
import { useFullscreen } from '@/hooks/useFullscreen'
import { cn } from '@/lib/utils'
import { streamdownPlugins, streamdownControls, streamdownComponents } from '@/components/chat/chat-shared'
import { FileDiffView } from './source-control/FileDiffView'
import { FileWithDiffView } from './source-control/FileWithDiffView'

const MARKDOWN_EXTS = new Set(['md', 'mdx', 'markdown'])
const BINARY_IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico'])
const PDF_EXTS = new Set(['pdf'])
const VIDEO_EXTS = new Set(['mp4', 'webm', 'ogg', 'mov'])
const AUDIO_EXTS = new Set(['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg'])

function getFileExt(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() ?? ''
}

function isMarkdown(fileName: string): boolean {
  return MARKDOWN_EXTS.has(getFileExt(fileName))
}

function isBinaryImage(fileName: string): boolean {
  return BINARY_IMAGE_EXTS.has(getFileExt(fileName))
}

function isPdf(fileName: string): boolean {
  return PDF_EXTS.has(getFileExt(fileName))
}

function isVideo(fileName: string): boolean {
  return VIDEO_EXTS.has(getFileExt(fileName))
}

function isAudio(fileName: string): boolean {
  return AUDIO_EXTS.has(getFileExt(fileName))
}

function isSvg(fileName: string): boolean {
  return getFileExt(fileName) === 'svg'
}

function SidebarToggle({ showSidebar, isFullscreen, onToggle }: { showSidebar: boolean; isFullscreen: boolean; onToggle: () => void }) {
  return (
    <>
      <div className={cn('shrink-0 transition-[width] duration-300 ease-in-out', !isFullscreen && !showSidebar ? 'w-[66px]' : 'w-0')} />
      <div className={cn('shrink-0 overflow-hidden transition-[width] duration-300 ease-in-out', showSidebar ? 'w-0' : 'w-[30px]')}>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onToggle}
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              >
                <PanelLeft className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={4}>
              <span>Toggle Sidebar</span> <CommandShortcut>⌘B</CommandShortcut>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </>
  )
}

type TabKey = 'changes' | 'file' | 'preview'

export function FilePanel() {
  const currentFolder = useAppStore((s) => s.currentFolder)
  const showSidebar = useAppStore((s) => s.showSidebar)
  const setShowSidebar = useAppStore((s) => s.setShowSidebar)
  const isFullscreen = useFullscreen()
  const { selectedFile, fileDiff, fileContent, activeTab, setActiveTab, clearSelection } = useSourceControlStore()

  const handleClose = useCallback(() => {
    useAppStore.getState().setShowFilePanel(false)
    clearSelection()
  }, [clearSelection])

  const fileName = selectedFile?.split('/').pop() ?? ''
  const hasDiff = !!fileDiff?.diff
  const isMd = isMarkdown(fileName)
  const isBinImg = isBinaryImage(fileName)
  const isPdfFile = isPdf(fileName)
  const isSvgFile = isSvg(fileName)
  const isVideoFile = isVideo(fileName)
  const isAudioFile = isAudio(fileName)
  const isBinaryPreview = isBinImg || isPdfFile || isVideoFile || isAudioFile

  const resolvedContent = useMemo(() => {
    const raw = fileContent?.content ?? ''
    if (!currentFolder || !selectedFile) return raw
    const dir = selectedFile.includes('/') ? selectedFile.substring(0, selectedFile.lastIndexOf('/')) : ''
    const baseDir = currentFolder + (dir ? '/' + dir : '')
    return raw.replace(
      /!\[([^\]]*)\]\((?!https?:\/\/|data:|local-file:\/\/)([^)\s]+)([^)]*)\)/g,
      (_, alt, src, rest) => {
        const cleanSrc = src.replace(/^\.\//, '')
        const resolved = src.startsWith('/')
          ? `local-file://${src}`
          : `local-file://${baseDir}/${cleanSrc}`
        return `![${alt}](${resolved}${rest})`
      },
    )
  }, [currentFolder, selectedFile, fileContent?.content])

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
  const toggleSidebar = useCallback(() => setShowSidebar(true), [setShowSidebar])

  if (!selectedFile) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <FileX2 className="size-8 opacity-30" />
        <span className="text-xs">Select a file from Files</span>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div
        className={cn('flex h-11 shrink-0 items-center pt-[2px] transition-[padding-left] duration-300 ease-in-out', isFullscreen || showSidebar ? 'pl-3' : 'pl-[18px]')}
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <SidebarToggle showSidebar={showSidebar} isFullscreen={isFullscreen} onToggle={toggleSidebar} />
        <FileIcon name={fileName} size={15} className="ml-2 shrink-0" />
        <span className="ml-1.5 min-w-0 flex-1 truncate text-xs font-medium">{fileName}</span>
        <div className="ml-2 flex items-center gap-1 pr-3" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          {tabs.length > 1 && (
            <Tabs value={effectiveTab} onValueChange={(v) => setActiveTab(v as TabKey)}>
              <TabsList>
                {tabs.map((tab) => (
                  <TabsTrigger key={tab.key} value={tab.key} className="text-[10px]">
                    {tab.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}
          <button
            onClick={handleClose}
            className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {effectiveTab === 'changes' && hasDiff ? (
          <FileDiffView
            filePath={selectedFile}
            diff={fileDiff?.diff ?? ''}
          />
        ) : effectiveTab === 'preview' && isBinImg ? (
          <div className="flex h-full items-center justify-center p-4">
            <img
              src={`local-file://${currentFolder}/${selectedFile}`}
              alt={fileName}
              className="max-h-full max-w-full object-contain"
            />
          </div>
        ) : effectiveTab === 'preview' && isPdfFile ? (
          <iframe
            src={`local-file://${currentFolder}/${selectedFile}`}
            className="h-full w-full border-0"
            title={fileName}
          />
        ) : effectiveTab === 'preview' && isVideoFile ? (
          <div className="flex h-full items-center justify-center p-4">
            <video
              src={`local-file://${currentFolder}/${selectedFile}`}
              controls
              preload="auto"
              className="max-h-full max-w-full"
            />
          </div>
        ) : effectiveTab === 'preview' && isAudioFile ? (
          <div className="flex h-full items-center justify-center p-4">
            <audio
              src={`local-file://${currentFolder}/${selectedFile}`}
              controls
              preload="auto"
            />
          </div>
        ) : effectiveTab === 'preview' && isSvgFile ? (
          <div className="flex h-full items-center justify-center p-4">
            <img
              src={`local-file://${currentFolder}/${selectedFile}`}
              alt={fileName}
              className="max-h-full max-w-full object-contain"
            />
          </div>
        ) : effectiveTab === 'preview' && isMd ? (
          <div className="chat-md p-4 text-sm">
            <Streamdown
              plugins={streamdownPlugins}
              components={streamdownComponents}
              controls={streamdownControls}
              rehypePlugins={previewRehypePlugins}
            >
              {resolvedContent}
            </Streamdown>
          </div>
        ) : (
          <FileWithDiffView
            filePath={selectedFile}
            content={fileContent?.content ?? ''}
            diff={fileDiff?.diff ?? ''}
          />
        )}
      </div>
    </div>
  )
}
