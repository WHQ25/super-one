import type { IDockviewPanelProps } from 'dockview-core'
import { FilePreview } from '@/components/coding/FilePreview'
import { MiniAppSlot } from '@/components/miniapp/MiniAppSlot'
import { BrowserView } from '@/components/browser/BrowserView'
import { ActivityTerminalPanel } from './ActivityTerminalPanel'

function FilePreviewPanel(props: IDockviewPanelProps<{ filePath: string }>) {
  return <FilePreview filePath={props.params.filePath} />
}

function MiniAppPanel(props: IDockviewPanelProps<{ instanceKey: string; appId: string }>) {
  return <MiniAppSlot instanceKey={props.params.instanceKey} mode="panel" className="h-full w-full" />
}

function BrowserPanel(props: IDockviewPanelProps<{ browserId: string; url: string }>) {
  return <BrowserView browserId={props.params.browserId} mode="panel" />
}

function TerminalHostPanel(props: IDockviewPanelProps<{ terminalId: string }>) {
  return <ActivityTerminalPanel terminalId={props.params.terminalId} api={props.api} />
}

export const activityPanelComponents: Record<string, React.FunctionComponent<IDockviewPanelProps>> = {
  'file-preview': FilePreviewPanel,
  'miniapp': MiniAppPanel as React.FunctionComponent<IDockviewPanelProps>,
  'browser': BrowserPanel as React.FunctionComponent<IDockviewPanelProps>,
  'terminal': TerminalHostPanel as React.FunctionComponent<IDockviewPanelProps>,
}
