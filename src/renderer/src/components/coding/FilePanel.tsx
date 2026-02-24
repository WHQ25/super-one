import { useCallback, useMemo } from 'react'
import { X, FileX2 } from 'lucide-react'
import { Streamdown } from 'streamdown'
import { FileIcon } from '@/components/ui/FileIcon'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/app'
import { useSourceControlStore } from '@/stores/source-control'
import { streamdownPlugins, streamdownControls, streamdownComponents } from '@/components/chat/chat-shared'
import { FileDiffView } from './source-control/FileDiffView'
import { FileWithDiffView } from './source-control/FileWithDiffView'

const MARKDOWN_EXTS = new Set(['md', 'mdx', 'markdown'])

function isMarkdown(fileName: string): boolean {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  return MARKDOWN_EXTS.has(ext)
}

type TabKey = 'changes' | 'file' | 'preview'

function TabSwitch({ tabs, active, onChange }: { tabs: { key: TabKey; label: string }[]; active: TabKey; onChange: (key: TabKey) => void }) {
  return (
    <div className="flex items-center rounded-md border border-border bg-muted/50 p-0.5">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          className={cn(
            'rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors',
            active === tab.key
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

export function FilePanel() {
  const currentFolder = useAppStore((s) => s.currentFolder)
  const { selectedFile, fileDiff, fileContent, diffLoading, activeTab, setActiveTab, clearSelection } = useSourceControlStore()

  const handleClose = useCallback(() => {
    useAppStore.getState().setShowFilePanel(false)
    clearSelection()
  }, [clearSelection])

  const fileName = selectedFile?.split('/').pop() ?? ''
  const hasDiff = !!fileDiff?.diff
  const isMd = isMarkdown(fileName)

  const tabs = useMemo(() => {
    const t: { key: TabKey; label: string }[] = []
    if (hasDiff) t.push({ key: 'changes', label: 'Changes' })
    t.push({ key: 'file', label: 'File' })
    if (isMd) t.push({ key: 'preview', label: 'Preview' })
    return t
  }, [hasDiff, isMd])

  const effectiveTab = tabs.find((t) => t.key === activeTab) ? activeTab : tabs[0]?.key ?? 'file'

  if (!selectedFile) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <FileX2 className="size-8 opacity-30" />
        <span className="text-xs">Select a file from Explorer</span>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div
        className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <FileIcon name={fileName} size={15} />
        <span className="min-w-0 flex-1 truncate text-xs font-medium">{fileName}</span>
        <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          {tabs.length > 1 && (
            <TabSwitch tabs={tabs} active={effectiveTab} onChange={setActiveTab} />
          )}
          <button
            onClick={handleClose}
            className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-background/70">
        {effectiveTab === 'changes' && hasDiff ? (
          <FileDiffView
            filePath={selectedFile}
            diff={fileDiff?.diff ?? ''}
            loading={diffLoading}
          />
        ) : effectiveTab === 'preview' && isMd ? (
          <div className="chat-md p-4 text-sm">
            <Streamdown
              plugins={streamdownPlugins}
              components={streamdownComponents}
              controls={streamdownControls}
            >
              {fileContent?.content ?? ''}
            </Streamdown>
          </div>
        ) : (
          <FileWithDiffView
            filePath={selectedFile}
            content={fileContent?.content ?? ''}
            diff={fileDiff?.diff ?? ''}
            loading={diffLoading}
          />
        )}
      </div>
    </div>
  )
}
