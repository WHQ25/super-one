import { useEffect, useState } from 'react'
import type { IDockviewPanelHeaderProps } from 'dockview-core'
import { Maximize, MessageSquare, X } from 'lucide-react'
import { motion } from 'motion/react'
import { cn } from '@superone/ui/lib/utils'
import { FileIcon } from '@superone/ui/components/ui/FileIcon'
import { MiniAppIcon } from '@/components/miniapp/MiniAppIcon'
import { useMiniAppStore } from '@/stores/miniapp'

function useIsActive(api: IDockviewPanelHeaderProps['api']) {
  const [active, setActive] = useState(api.isActive)
  useEffect(() => {
    setActive(api.isActive)
    const d = api.onDidActiveChange((e) => setActive(e.isActive))
    return () => d.dispose()
  }, [api])
  return active
}

function HoverCloseSlot({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="relative size-3.5 shrink-0">
      <div className="absolute inset-0 transition-opacity [div:hover>div>&]:opacity-0">
        {children}
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onClose() }}
        className="absolute inset-0 flex items-center justify-center rounded-full bg-foreground/15 text-foreground/80 opacity-0 transition-opacity hover:bg-foreground/25 [div:hover>div>&]:opacity-100"
        title="Close"
      >
        <X className="size-2.5" strokeWidth={2.5} />
      </button>
    </div>
  )
}

function tabChipClass(active: boolean): string {
  return cn(
    'flex items-center gap-1.5 rounded-lg px-2 py-1.5 transition-colors',
    active
      ? 'bg-muted text-foreground'
      : 'text-muted-foreground hover:text-foreground',
  )
}

export function FilePreviewTab(props: IDockviewPanelHeaderProps<{ filePath: string }>) {
  const fileName = props.params.filePath.split('/').pop() ?? ''
  const active = useIsActive(props.api)

  return (
    <div className={tabChipClass(active)}>
      <HoverCloseSlot onClose={() => props.api.close()}>
        {fileName && <FileIcon name={fileName} size={14} className="shrink-0" />}
      </HoverCloseSlot>
      <span className="truncate text-xs">{fileName || 'File'}</span>
    </div>
  )
}

export function MiniAppTab(props: IDockviewPanelHeaderProps<{ instanceKey: string; appId: string }>) {
  const { instanceKey, appId } = props.params
  const app = useMiniAppStore((s) => s.apps.find((a) => a.id === appId))
  const moveAppToCanvas = useMiniAppStore((s) => s.moveAppToCanvas)
  const closeApp = useMiniAppStore((s) => s.closeApp)
  const canFullscreen = app?.manifest.fullscreen === true
  const active = useIsActive(props.api)

  return (
    <div className={tabChipClass(active)}>
      <HoverCloseSlot onClose={() => { void closeApp(instanceKey) }}>
        <MiniAppIcon appId={appId} className="size-3.5 shrink-0" />
      </HoverCloseSlot>
      <span className="truncate text-xs">{props.api.title}</span>
      {canFullscreen && (
        <motion.button
          initial={false}
          animate={{
            width: active ? 16 : 0,
            marginLeft: active ? 2 : 0,
            opacity: active ? 1 : 0,
          }}
          transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
          onClick={(e) => { e.stopPropagation(); moveAppToCanvas(instanceKey) }}
          className="flex h-4 shrink-0 items-center justify-center overflow-hidden rounded text-foreground/60 hover:text-foreground"
          title="Open in fullscreen"
        >
          <Maximize className="size-3 shrink-0" />
        </motion.button>
      )}
    </div>
  )
}

export function SessionHistoryTab(props: IDockviewPanelHeaderProps) {
  const active = useIsActive(props.api)

  return (
    <div className={tabChipClass(active)}>
      <HoverCloseSlot onClose={() => props.api.close()}>
        <MessageSquare className="size-3.5 shrink-0" />
      </HoverCloseSlot>
      <span className="truncate text-xs">{props.api.title}</span>
    </div>
  )
}

export const activityTabComponents: Record<string, React.FunctionComponent<IDockviewPanelHeaderProps>> = {
  'file-preview-tab': FilePreviewTab as React.FunctionComponent<IDockviewPanelHeaderProps>,
  'miniapp-tab': MiniAppTab as React.FunctionComponent<IDockviewPanelHeaderProps>,
  'session-history-tab': SessionHistoryTab,
}
