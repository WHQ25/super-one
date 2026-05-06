import type { IDockviewPanelProps } from 'dockview-core'
import { FilePreview } from '@/components/coding/FilePreview'
import { SessionHistory } from '@/components/chat/SessionHistory'
import { MiniAppView } from '@/components/miniapp/MiniAppView'
import { useActivityPanelStore } from '@/stores/activity-panel'

function FilePreviewPanel(props: IDockviewPanelProps<{ filePath: string }>) {
  return <FilePreview filePath={props.params.filePath} />
}

function SessionHistoryPanel(props: IDockviewPanelProps) {
  const handleClose = () => {
    props.api.close()
    const api = props.containerApi
    if (api.panels.length === 0) {
      useActivityPanelStore.getState().setShowPanel(false)
    }
  }
  return <SessionHistory showBackButton={false} onClose={handleClose} />
}

function MiniAppPanel(props: IDockviewPanelProps<{ appId: string }>) {
  return <MiniAppView appId={props.params.appId} className="h-full w-full" />
}

export const activityPanelComponents: Record<string, React.FunctionComponent<IDockviewPanelProps>> = {
  'file-preview': FilePreviewPanel,
  'session-history': SessionHistoryPanel,
  'miniapp': MiniAppPanel as React.FunctionComponent<IDockviewPanelProps>,
}
