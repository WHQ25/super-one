import { McpAppPanel } from '@/components/mcp-apps/McpAppSlot'
import type { IDockviewPanelProps } from 'dockview-core'
import { FilePreview } from '@/components/coding/FilePreview'
import { MiniAppSlot } from '@/components/miniapp/MiniAppSlot'
import { toolUiPreviewSlotKey } from '@/stores/miniapp-tool-preview'
import { BrowserView } from '@/components/browser/BrowserView'
import { TrajectoryPanel } from '@/components/trajectory/TrajectoryPanel'
import { DeviceDockPanel } from '@/components/device/DeviceDockPanel'
import { SideChatPanel } from '@/components/chat/SideChatPanel'
import { ActivityTerminalPanel } from './ActivityTerminalPanel'

function FilePreviewPanel(props: IDockviewPanelProps<{ filePath: string }>) {
  return <FilePreview filePath={props.params.filePath} />
}

function MiniAppPanel(props: IDockviewPanelProps<{ instanceKey: string; appId: string }>) {
  return <MiniAppSlot slotKey={props.params.instanceKey} mode="panel" className="h-full w-full" />
}

function ToolUiPreviewPanel(props: IDockviewPanelProps<{ previewKey: string }>) {
  // Drawn by the mini-app host layer so it can also move into picture-in-picture.
  return <MiniAppSlot slotKey={toolUiPreviewSlotKey(props.params.previewKey)} mode="panel" className="h-full w-full" />
}

function BrowserPanel(props: IDockviewPanelProps<{ browserId: string; url: string }>) {
  return <BrowserView browserId={props.params.browserId} mode="panel" />
}

function TerminalHostPanel(props: IDockviewPanelProps<{ terminalId: string }>) {
  return <ActivityTerminalPanel terminalId={props.params.terminalId} api={props.api} />
}

function TrajectoryDockPanel(props: IDockviewPanelProps<{ sessionId: string }>) {
  return <TrajectoryPanel sessionId={props.params.sessionId} />
}

function SideChatDockPanel(props: IDockviewPanelProps<{ projectPath: string; sessionId: string }>) {
  return <SideChatPanel projectPath={props.params.projectPath} sessionId={props.params.sessionId} />
}

export const activityPanelComponents: Record<string, React.FunctionComponent<IDockviewPanelProps>> = {
  'file-preview': FilePreviewPanel,
  'mcp-app': McpAppPanel as React.FunctionComponent<IDockviewPanelProps>,
  'miniapp': MiniAppPanel as React.FunctionComponent<IDockviewPanelProps>,
  'miniapp-tool-preview': ToolUiPreviewPanel as React.FunctionComponent<IDockviewPanelProps>,
  'browser': BrowserPanel as React.FunctionComponent<IDockviewPanelProps>,
  'terminal': TerminalHostPanel as React.FunctionComponent<IDockviewPanelProps>,
  'trajectory': TrajectoryDockPanel as React.FunctionComponent<IDockviewPanelProps>,
  'device': DeviceDockPanel as React.FunctionComponent<IDockviewPanelProps>,
  'side-chat': SideChatDockPanel as React.FunctionComponent<IDockviewPanelProps>,
}
