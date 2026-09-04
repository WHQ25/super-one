import { useMemo } from 'react'
import {
  BrowserToolBlockPresenter,
  type BrowserDetail,
  type BrowserDownloadRuntime,
} from '@superone/chat-view/presenters/BrowserToolBlock'
import { parseBrowserResult, type BrowserOp } from './browser-tool-display'
import { getStallColor, type StallLevel } from '@/lib/stall-utils'
import { useChatStore } from '@/stores/chat-store'
import { ToolIcon } from './ToolIcon'
import { FileChip } from './ToolBlock'
import { PrettyJSONCodeBlock, BrowserEvaluateView, BrowserMockView } from './tool-result-views'
import { ToolScreenshotView } from './ToolScreenshotView'
import { ActionRecordingView, parseActionRecording } from './ActionRecordingView'
import { BrowserPageToolCallBlock, BrowserPageToolsListBlock } from './BrowserPageToolsBlock'

interface BrowserToolBlockProps {
  op: BrowserOp
  params: Record<string, unknown>
  result?: string
  isStreaming: boolean
  isError?: boolean
  isDenied?: boolean
  elapsedSeconds?: number
  stallLevel: StallLevel
  allowExpand?: boolean
}

function renderDetail(detail: BrowserDetail) {
  if (detail.kind === 'mock') return <BrowserMockView params={detail.params} />
  if (detail.kind === 'evaluate') {
    return <BrowserEvaluateView expression={detail.expression} result={detail.result} />
  }
  return <PrettyJSONCodeBlock text={detail.result} />
}

function renderFile(path: string, filename: string) {
  return <FileChip name={filename} title={path} filePath={path} className="max-w-50" />
}

async function saveFile(path: string, filename: string): Promise<'saved' | 'cancelled' | 'error'> {
  const result = await window.app.saveFileAs(path, filename)
  if (result.ok) return 'saved'
  return result.canceled ? 'cancelled' : 'error'
}

export function BrowserToolBlock(props: BrowserToolBlockProps) {
  if (props.op === 'tools_list' || props.op === 'tools_call') {
    const PageBlock = props.op === 'tools_list' ? BrowserPageToolsListBlock : BrowserPageToolCallBlock
    return <PageBlock {...props} />
  }
  return <DesktopBrowserToolBlock {...props} />
}

function DesktopBrowserToolBlock(props: BrowserToolBlockProps) {
  const info = useMemo(
    () => parseBrowserResult(props.op, props.result, !!props.isError),
    [props.isError, props.op, props.result],
  )
  const taskId = info.download?.taskId
  const live = useChatStore((state): BrowserDownloadRuntime | undefined => {
    if (!taskId || !state.activeProject) return undefined
    const project = state.projectSessions[state.activeProject]
    const sessionId = project?._activeSessionId
    if (!sessionId) return undefined
    return project._sessions[sessionId]?.browserDownloads[taskId]
  })
  const recording = useMemo(() => parseActionRecording(props.result), [props.result])

  return (
    <BrowserToolBlockPresenter
      {...props}
      elapsedClassName={getStallColor(props.stallLevel)}
      renderIcon={(kind) => <ToolIcon icon={kind} className="size-3 shrink-0 text-muted-foreground" />}
      renderScreenshot={(path, label, unavailableLabel) => (
        <ToolScreenshotView path={path} label={label} unavailableLabel={unavailableLabel} />
      )}
      renderDetail={renderDetail}
      renderFile={renderFile}
      onSaveFile={saveFile}
      recording={recording ? <ActionRecordingView recording={recording} /> : undefined}
      downloadRuntime={live}
    />
  )
}
