import type { IDockviewPanelProps } from 'dockview-core'
import { FilePreview } from '@/components/coding/FilePreview'
import { SessionHistory } from '@/components/chat/SessionHistory'
import { MiniAppSlot } from '@/components/miniapp/MiniAppSlot'
import { useActivityPanelStore } from '@/stores/activity-panel'
import { useChatStore } from '@/stores/chat'

function FilePreviewPanel(props: IDockviewPanelProps<{ filePath: string }>) {
  return <FilePreview filePath={props.params.filePath} />
}

function SessionHistoryPanel(props: IDockviewPanelProps<{ folderPath?: string }>) {
  const activeProject = useChatStore((s) => s.activeProject)
  const folderPath = props.params.folderPath ?? activeProject
  const handleClose = () => {
    props.api.close()
    const api = props.containerApi
    if (api.panels.length === 0) {
      useActivityPanelStore.getState().setShowPanel(false)
    }
  }
  if (!folderPath) return null
  return <SessionHistory folderPath={folderPath} showBackButton={false} onClose={handleClose} />
}

function MiniAppPanel(props: IDockviewPanelProps<{ instanceKey: string; appId: string }>) {
  return <MiniAppSlot instanceKey={props.params.instanceKey} mode="panel" className="h-full w-full" />
}

export const activityPanelComponents: Record<string, React.FunctionComponent<IDockviewPanelProps>> = {
  'file-preview': FilePreviewPanel,
  'session-history': SessionHistoryPanel,
  'miniapp': MiniAppPanel as React.FunctionComponent<IDockviewPanelProps>,
}
