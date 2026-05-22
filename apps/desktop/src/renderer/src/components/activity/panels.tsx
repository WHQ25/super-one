import type { IDockviewPanelProps } from 'dockview-core'
import { FilePreview } from '@/components/coding/FilePreview'
import { MiniAppSlot } from '@/components/miniapp/MiniAppSlot'

function FilePreviewPanel(props: IDockviewPanelProps<{ filePath: string }>) {
  return <FilePreview filePath={props.params.filePath} />
}

function MiniAppPanel(props: IDockviewPanelProps<{ instanceKey: string; appId: string }>) {
  return <MiniAppSlot instanceKey={props.params.instanceKey} mode="panel" className="h-full w-full" />
}

export const activityPanelComponents: Record<string, React.FunctionComponent<IDockviewPanelProps>> = {
  'file-preview': FilePreviewPanel,
  'miniapp': MiniAppPanel as React.FunctionComponent<IDockviewPanelProps>,
}
