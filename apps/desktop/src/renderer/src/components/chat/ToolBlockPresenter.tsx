import { memo, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Ban, ChevronRight, TriangleAlert } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import { parsePartialWidgetInput, parseWidgetResult } from '@superone/shared/generative-ui/types'
import { AutomationToolBlock, isAutomationToolName } from './AutomationToolBlock'
import { BrowserToolBlock } from './BrowserToolBlock'
import { ComputerUseToolBlock } from './ComputerUseToolBlock'
import { DeviceToolBlock } from './DeviceToolBlock'
import { getBrowserOp } from './browser-tool-display'
import { getComputerOp } from './computer-tool-display'
import { getDeviceOp } from './device-tool-display'
import { ImageGenToolBlock } from './ImageGenToolBlock'
import { ListAgentsToolBlock } from './ListAgentsToolBlock'
import { MediaProvidersBlock } from './MediaProvidersBlock'
import { isMediaToolErrorResult } from './media-generation'
import { ReportFindingsToolBlock } from './ReportFindingsToolBlock'
import { SessionArchiveToolBlock, isSessionArchiveToolName } from './SessionArchiveToolBlock'
import {
  getToolDisplay,
  getToolLabel,
  getToolVerb,
  isHiddenToolBlock,
  formatReadMeta,
  parseMcpToolName,
  parseToolInput,
  type ToolIcon as ToolIconType,
} from './tool-display'
import {
  computeLineDelta,
  computeStreamingEditDelta,
  extractToolError,
  tryPrettifyJson,
  unwrapMcpResultText,
} from './presenters/tool-block-utils'
import {
  CompactLabeledToolRow,
  ExpandableToolRow,
  ToolName,
  toolOutcomeLabel,
  toolRowSurfaceClass,
  withStreamingEllipsis,
  type ToolRowTone,
} from './tool-row'
import { ToolIcon } from './ToolIcon'
import {
  GenericToolRowPresenter,
  type FileChipPortProps,
  type FileDiffPresenterProps,
  type GenericToolRowPorts,
} from '@superone/chat-view/presenters/GenericToolRow'
import { VideoGenToolBlock } from './VideoGenToolBlock'
import { WidgetBlock } from './WidgetBlock'
import { isWorkflowSmokeCheck } from './workflow-utils'
import { EnterPlanModeBlock } from './presenters/PlanModeBlocks'
import {
  COLLAB_TOOLS,
  SessionCollabToolBlock,
} from './tool-block-presenters/SessionCollabToolBlock'
import {
  ConfigApplyBlock,
  SetupMiniAppDevBlock,
} from './tool-block-presenters/ConfigToolBlocks'

function isCompleteJson(s: string): boolean {
  try { JSON.parse(s); return true } catch { return false }
}

const SUPERONE_SERVER = 'superone'

function toolRowTone(isDenied?: boolean, isError?: boolean): ToolRowTone {
  if (isDenied) return 'denied'
  if (isError) return 'error'
  return 'default'
}

/** Dev-only raw input/output view for selected tool names. */
const DEBUG_TOOL_NAMES: string[] = import.meta.env.DEV
  ? (import.meta.env.RENDERER_VITE_DEBUG_TOOL_NAMES ?? '')
      .split(',')
      .map((name: string) => name.trim().toLowerCase())
      .filter(Boolean)
  : []


export interface ToolBlockProps {
  toolName: string
  toolUseId?: string
  input: string
  /** Precomputed summary from ACP/main (e.g. Grok title / raw_output query). */
  toolSummary?: string
  status?: 'streaming' | 'complete'
  elapsedSeconds?: number
  result?: string
  isTimedOut?: boolean
  isError?: boolean
  resultOutputPath?: string
  autoExpand?: boolean
  backgroundActivity?: boolean
  grouped?: boolean
  trailingAction?: ReactNode
}

export interface BashToolPresenterProps {
  toolUseId: string
  command: string
  description?: string
  fallbackResult?: string
  isStreaming: boolean
  isDenied?: boolean
  isError?: boolean
  timeoutMs?: number
  isTimedOut?: boolean
  resultOutputPath?: string
  runInBackground?: boolean
  autoExpand?: boolean
  allowExpand?: boolean
  backgroundActivity?: boolean
  trailingAction?: ReactNode
}

export interface MobileSharePresenterProps {
  params: Record<string, unknown>
  result: string | null
  isStreaming: boolean
  isDenied?: boolean
  isError?: boolean
  allowExpand: boolean
}

export interface MiniAppToolPresenterProps {
  mcpToolName: string
  params: Record<string, unknown>
  result?: string
  isStreaming: boolean
  isDenied: boolean
  isError: boolean
  allowExpand: boolean
  grouped: boolean
  toolUseId?: string
}

export interface ToolFamilyRenderResult {
  handled: boolean
  node: ReactNode
}

export interface ToolBlockPresenterPorts extends GenericToolRowPorts {
  onOpenSession: (sessionId: string) => void | Promise<void>
  onWidgetInputComplete?: (data: { title?: string; inputLength: number }) => void
  renderBash: (props: BashToolPresenterProps) => ReactNode
  renderMobileShare: (props: MobileSharePresenterProps) => ReactNode
  renderExitPlanMode: (result?: string) => ReactNode
  renderMiniAppTool: (props: MiniAppToolPresenterProps) => ToolFamilyRenderResult
}

export interface ToolBlockPresenterProps extends ToolBlockProps {
  allowExpand: boolean
  defaultAutoExpand?: boolean
  autoExpandFileDiffs: boolean
  ports: ToolBlockPresenterPorts
}

const DIFF_TOOLS = new Set(['Edit', 'Write', 'FileChange'])
const FILE_PATH_TOOLS = new Set(['Read', 'Edit', 'Write', 'NotebookEdit', 'FileChange'])



export const ToolBlockPresenter = memo(function ToolBlockPresenter({
  toolName,
  toolUseId,
  input,
  toolSummary,
  status,
  elapsedSeconds,
  result,
  isTimedOut,
  isError,
  resultOutputPath,
  autoExpand,
  backgroundActivity = false,
  grouped = false,
  trailingAction,
  allowExpand,
  defaultAutoExpand,
  autoExpandFileDiffs,
  ports,
}: ToolBlockPresenterProps) {
  const { t } = useTranslation()
  // Bash and other non-diff tools keep the historical default of auto-expand.
  // File diffs (Edit/Write/FileChange) honor the user setting (default: off).
  const effectiveAutoExpand = allowExpand && (autoExpand ?? defaultAutoExpand ?? true)
  const shouldAutoExpandDiff = allowExpand && (autoExpand ?? defaultAutoExpand ?? autoExpandFileDiffs)
  const parsedParams = useMemo(() => parseToolInput(input, toolName), [input, toolName])
  const isStreaming = status === 'streaming'
  const params = isStreaming && ports.streamingInputPreview ? ports.streamingInputPreview : parsedParams
  const display = useMemo(() => getToolDisplay(toolName, params, ports.cwd, ports.homedir), [toolName, params, ports.cwd, ports.homedir])
  const mcpInfo = parseMcpToolName(toolName)
  const isMcp = mcpInfo !== null
  const stallLevel = ports.stallLevel

  const isDenied = !!result && result.startsWith('[denied] ')
  const rawResult = isDenied ? result.slice('[denied] '.length) : result
  // MCP tools report their outcome as a serialized reply envelope; native tools report plain text.
  // Unwrap here so every downstream block parses one shape.
  const cleanResult = useMemo(
    () => (isMcp && rawResult ? unwrapMcpResultText(rawResult) : rawResult),
    [isMcp, rawResult],
  )
  // Debug mode (dev only): highest priority — show raw input/output for matching tools
  // Set RENDERER_VITE_DEBUG_TOOL_NAMES=TodoWrite,TaskCreate to enable
  const isDebug = DEBUG_TOOL_NAMES.length > 0 &&
    DEBUG_TOOL_NAMES.some((n) => toolName.toLowerCase().includes(n))
  if (isDebug) {
    return <DebugToolBlock toolName={toolName} input={input} result={result} status={status} elapsedSeconds={elapsedSeconds} />
  }

  if (isHiddenToolBlock(toolName, result)) return null

  const isQuestionDismissed = toolName === 'AskUserQuestion' && !!result && (isDenied || result.includes('dismissed'))

  if (toolName === 'Bash') {
    const timeout = typeof params.timeout === 'number' ? params.timeout : undefined
    const runInBackground = params.run_in_background === true || params.background === true
    const description = typeof params.description === 'string' ? params.description : undefined
    return ports.renderBash({
      toolUseId: toolUseId ?? '',
      command: display.summary,
      description,
      fallbackResult: isDenied ? undefined : (result ?? undefined),
      isStreaming,
      isDenied,
      isError,
      timeoutMs: timeout,
      isTimedOut,
      resultOutputPath,
      runInBackground,
      autoExpand: effectiveAutoExpand,
      allowExpand,
      backgroundActivity,
      trailingAction,
    })
  }

  if (toolName === 'EnterPlanMode') {
    return <EnterPlanModeBlock />
  }
  if (toolName === 'ExitPlanMode') {
    return ports.renderExitPlanMode(result)
  }
  // The review's findings live entirely in the input — the result is a bare ack — so
  // this dispatches on the params and never waits for a result to render.
  if (toolName === 'ReportFindings') {
    return (
      <ReportFindingsToolBlock
        params={params}
        isStreaming={isStreaming}
        isError={isError}
        isDenied={isDenied}
        elapsedSeconds={elapsedSeconds}
        stallLevel={stallLevel}
        allowExpand={allowExpand}
      />
    )
  }
  // The roster lives entirely in the result — the input is `{}` — so this dispatches on
  // the output and shows a header-only row while the call is still in flight.
  if (toolName === 'ListAgents') {
    return (
      <ListAgentsToolBlock
        // A denial carries no roster, only the refusal sentence the badge already says.
        result={isDenied ? undefined : cleanResult}
        isStreaming={isStreaming}
        isError={isError}
        isDenied={isDenied}
        allowExpand={allowExpand}
      />
    )
  }
  if (mcpInfo?.serverName === SUPERONE_SERVER) {
    const browserOp = getBrowserOp(mcpInfo.mcpToolName, params)
    if (browserOp) {
      return (
        <BrowserToolBlock
          op={browserOp}
          params={params}
          result={cleanResult}
          isStreaming={isStreaming}
          isError={isError}
          isDenied={isDenied}
          elapsedSeconds={elapsedSeconds}
          stallLevel={stallLevel}
          allowExpand={allowExpand}
        />
      )
    }
    const computerOp = getComputerOp(mcpInfo.mcpToolName)
    if (computerOp) {
      return (
        <ComputerUseToolBlock
          op={computerOp}
          params={params}
          result={cleanResult}
          isStreaming={isStreaming}
          isError={isError}
          isDenied={isDenied}
          elapsedSeconds={elapsedSeconds}
          stallLevel={stallLevel}
          allowExpand={allowExpand}
        />
      )
    }
    const deviceOp = getDeviceOp(mcpInfo.mcpToolName)
    if (deviceOp) {
      return (
        <DeviceToolBlock
          op={deviceOp}
          params={params}
          result={cleanResult}
          isStreaming={isStreaming}
          isError={isError}
          isDenied={isDenied}
          elapsedSeconds={elapsedSeconds}
          stallLevel={stallLevel}
          allowExpand={allowExpand}
        />
      )
    }
    const superoneToolDisplay: Record<string, { icon: ToolIconType; streaming: string; action: string; done: string; summaryField?: string }> = {
      media_list_providers: { icon: 'image', streaming: t('chat.toolBlock.listingMediaProviders'), action: t('chat.toolBlock.listMediaProviders'), done: t('chat.toolBlock.listedMediaProviders') },
      miniapp_dev_register: { icon: 'package', streaming: t('chat.toolBlock.registeringMiniApp'), action: t('chat.toolBlock.registerMiniApp'), done: t('chat.toolBlock.registeredMiniApp'), summaryField: 'name' },
      miniapp_dev_update_types: { icon: 'wrench', streaming: t('chat.toolBlock.updatingMiniAppTypes'), action: t('chat.toolBlock.updateMiniAppTypes'), done: t('chat.toolBlock.updatedMiniAppTypes') },
      widget_list_templates: { icon: 'canvas', streaming: t('chat.toolBlock.listingWidgetTemplates'), action: t('chat.toolBlock.listWidgetTemplates'), done: t('chat.toolBlock.listedWidgetTemplates') },
      media_video_status: { icon: 'image', streaming: t('chat.toolBlock.checkingVideoStatus'), action: t('chat.toolBlock.checkVideoStatus'), done: t('chat.toolBlock.checkVideoStatus') },
    }
    if (mcpInfo.mcpToolName === 'mobile_share_file') {
      return ports.renderMobileShare({
        params,
        result: !isStreaming ? (result ?? null) : null,
        isStreaming,
        isDenied,
        isError: !!isError,
        allowExpand,
      })
    }
    if (mcpInfo.mcpToolName === 'config_apply') {
      return (
        <ConfigApplyBlock
          params={params}
          result={!isStreaming ? (result ?? null) : null}
          isStreaming={isStreaming}
          isError={!!isError}
          isDenied={isDenied}
          allowExpand={allowExpand}
        />
      )
    }
    if (mcpInfo.mcpToolName === 'config_read') {
      const hasDomain = typeof params.domain === 'string' && params.domain.length > 0
      let domainLabel = ''
      if (!isStreaming && result) {
        try {
          const parsed = JSON.parse(result)
          if (parsed && typeof parsed === 'object' && typeof parsed.label === 'string') domainLabel = parsed.label
        } catch { /* ignore */ }
      }
      const summaryValue = domainLabel
        || (hasDomain ? String(params.domain) : (!isStreaming ? t('chat.toolBlock.guideOverview') : ''))
      return (
        <CompactLabeledToolRow
          icon={<ToolIcon icon="book-open" className="size-3 shrink-0 text-muted-foreground" />}
          label={withStreamingEllipsis(
            toolOutcomeLabel({
              streaming: isStreaming,
              interrupted: isDenied || !!isError,
              streamingLabel: t('chat.toolBlock.readingConfig'),
              actionLabel: t('chat.toolBlock.readSettings'),
              doneLabel: t('chat.toolBlock.readConfig'),
            }),
            isStreaming,
          )}
          streaming={isStreaming}
          tone={toolRowTone(isDenied, isError)}
          summary={summaryValue || undefined}
        />
      )
    }
    if (mcpInfo.mcpToolName === 'read_manual') {
      const domain = typeof params.domain === 'string' ? params.domain : ''
      const topic = typeof params.topic === 'string' ? params.topic : ''
      const summary = [domain, topic].filter(Boolean).join('/')
      return (
        <CompactLabeledToolRow
          icon={<ToolIcon icon="book-open" className="size-3 shrink-0 text-muted-foreground" />}
          label={withStreamingEllipsis(
            toolOutcomeLabel({
              streaming: isStreaming,
              interrupted: isDenied || !!isError,
              streamingLabel: t('chat.toolBlock.readingManual'),
              actionLabel: t('chat.toolBlock.readManualAction'),
              doneLabel: t('chat.toolBlock.readManual'),
            }),
            isStreaming,
          )}
          streaming={isStreaming}
          tone={toolRowTone(isDenied, isError)}
          summary={summary || undefined}
        />
      )
    }
    if (mcpInfo.mcpToolName === 'media_generate_image') {
      return (
        <ImageGenToolBlock
          params={params}
          result={cleanResult}
          isStreaming={isStreaming}
          isError={isError}
          isDenied={isDenied}
          allowExpand={allowExpand}
        />
      )
    }
    if (mcpInfo.mcpToolName === 'media_list_providers') {
      return (
        <MediaProvidersBlock
          result={!isStreaming ? cleanResult ?? null : null}
          isStreaming={isStreaming}
          isError={isError}
          isDenied={isDenied}
          allowExpand={allowExpand}
        />
      )
    }
    if (mcpInfo.mcpToolName === 'media_generate_video') {
      const videoFailed = !isDenied && isMediaToolErrorResult(cleanResult, isError)
      if (!allowExpand || isDenied) {
        const prompt = typeof params.prompt === 'string' ? params.prompt.replace(/\s+/g, ' ').trim() : ''
        return (
          <CompactLabeledToolRow
            icon={<ToolIcon icon="image" className="size-3 shrink-0 text-muted-foreground" />}
            label={withStreamingEllipsis(
              toolOutcomeLabel({
                streaming: isStreaming,
                interrupted: isDenied || videoFailed,
                streamingLabel: t('chat.toolBlock.generatingVideo'),
                actionLabel: t('chat.toolBlock.generateVideo'),
                doneLabel: t('chat.toolBlock.generatedVideo'),
              }),
              isStreaming,
            )}
            streaming={isStreaming}
            tone={toolRowTone(isDenied, videoFailed)}
            summary={prompt || undefined}
          />
        )
      }
      return (
        <VideoGenToolBlock
          params={params}
          result={cleanResult}
          isStreaming={isStreaming}
          isError={!!isError || videoFailed}
        />
      )
    }
    if (COLLAB_TOOLS.has(mcpInfo.mcpToolName)) {
      return (
        <SessionCollabToolBlock
          toolName={mcpInfo.mcpToolName}
          params={params}
          result={cleanResult}
          isStreaming={isStreaming}
          isError={isError}
          isDenied={isDenied}
          allowExpand={allowExpand}
          onOpenSession={ports.onOpenSession}
        />
      )
    }
    if (mcpInfo.mcpToolName === 'session_tag') {
      const added = Array.isArray(params.add) ? params.add.filter((tag): tag is string => typeof tag === 'string') : []
      const removed = Array.isArray(params.remove) ? params.remove.filter((tag): tag is string => typeof tag === 'string') : []
      const set = Array.isArray(params.set) ? params.set.filter((tag): tag is string => typeof tag === 'string') : []
      const tagBits = added.length
        ? added.join(', ')
        : removed.length
          ? removed.join(', ')
          : set.length
            ? set.join(', ')
            : ''
      const ids = Array.isArray(params.sessionIds) ? params.sessionIds.length : 0
      const summary = [tagBits, ids > 1 ? `${ids}` : ''].filter(Boolean).join(' · ')
      const label = toolOutcomeLabel({
        streaming: isStreaming,
        interrupted: isDenied || !!isError,
        streamingLabel: t('chat.toolBlock.archive.taggingSession'),
        actionLabel: t('chat.toolBlock.archive.tagSession'),
        doneLabel: t('chat.toolBlock.archive.sessionTagged'),
      })
      return (
        <CompactLabeledToolRow
          icon={<ToolIcon icon="clipboard-list" className="size-3 shrink-0 text-muted-foreground" />}
          label={withStreamingEllipsis(label, isStreaming)}
          streaming={isStreaming}
          tone={toolRowTone(isDenied, isError)}
          summary={summary || undefined}
        />
      )
    }
    if (isSessionArchiveToolName(mcpInfo.mcpToolName)) {
      return (
        <SessionArchiveToolBlock
          toolName={mcpInfo.mcpToolName}
          params={params}
          result={cleanResult}
          isStreaming={isStreaming}
          isError={isError}
          isDenied={isDenied}
          allowExpand={allowExpand}
        />
      )
    }
    if (isAutomationToolName(mcpInfo.mcpToolName)) {
      return (
        <AutomationToolBlock
          toolName={mcpInfo.mcpToolName}
          params={params}
          result={cleanResult}
          isStreaming={isStreaming}
          isError={isError}
          isDenied={isDenied}
          allowExpand={allowExpand}
        />
      )
    }
    if (mcpInfo.mcpToolName === 'miniapp_dev_setup') {
      const appName = String(params.name ?? '')
      let parsedResult: Record<string, unknown> | null = null
      if (!isStreaming && result) {
        try { parsedResult = JSON.parse(result) as Record<string, unknown> } catch {}
      }
      return (
        <SetupMiniAppDevBlock
          appName={appName}
          isStreaming={isStreaming}
          params={params}
          result={parsedResult}
          isDenied={isDenied}
          isError={!!isError}
          allowExpand={allowExpand}
        />
      )
    }
    const d = superoneToolDisplay[mcpInfo.mcpToolName]
    if (d) {
      const rawSummary = d.summaryField
        ? String(params[d.summaryField] || params.directory || params.appDir || '').replace(/\s+/g, ' ').trim()
        : mcpInfo.mcpToolName === 'miniapp_dev_update_types'
          ? String(params.appDir ?? '').split('/').pop() ?? ''
          : ''
      const summaryValue = rawSummary.includes('/') ? rawSummary.split('/').pop() ?? rawSummary : rawSummary
      return (
        <CompactLabeledToolRow
          icon={<ToolIcon icon={d.icon} className="size-3 shrink-0 text-muted-foreground" />}
          label={withStreamingEllipsis(
            toolOutcomeLabel({
              streaming: isStreaming,
              interrupted: isDenied || !!isError,
              streamingLabel: d.streaming,
              actionLabel: d.action,
              doneLabel: d.done,
            }),
            isStreaming,
          )}
          streaming={isStreaming}
          tone={toolRowTone(isDenied, isError)}
          summary={summaryValue || undefined}
        />
      )
    }
    const miniAppTool = ports.renderMiniAppTool({
      mcpToolName: mcpInfo.mcpToolName,
      params,
      result,
      isStreaming,
      isDenied,
      isError: !!isError,
      allowExpand,
      grouped,
      toolUseId,
    })
    if (miniAppTool.handled) return miniAppTool.node
  }

  // Result-as-UI only holds while there is a result to *be* the UI. A failed or denied call has
  // none, so it falls through to the default row, which is the only branch that surfaces the reason
  // — native templates made this reachable, since a bad path or data shape is an ordinary,
  // agent-fixable outcome rather than an internal error.
  if (mcpInfo?.mcpToolName === 'widget_show' && !isError && !isDenied) {
    const widgetData = (result ? parseWidgetResult(result) : null) ?? parsePartialWidgetInput(input)
    const jsonComplete = isCompleteJson(input)
    const inputComplete = !isStreaming || jsonComplete
    if (isStreaming && jsonComplete && widgetData) {
      ports.onWidgetInputComplete?.({ title: widgetData.title, inputLength: input.length })
    }
    // Subagent card: never mount the full widget UI — header-only stub.
    if (!allowExpand) {
      const title = widgetData && typeof (widgetData as { title?: unknown }).title === 'string'
        ? (widgetData as { title: string }).title
        : ''
      return (
        <CompactLabeledToolRow
          icon={<ToolIcon icon="canvas" className="size-3 shrink-0 text-muted-foreground" />}
          label={isStreaming ? t('chat.toolBlock.generatingWidget') : t('chat.toolBlock.generateWidget')}
          streaming={isStreaming}
          summary={title || undefined}
        />
      )
    }
    if (widgetData) return <WidgetBlock data={widgetData} streaming={!inputComplete} />
    return (
      <CompactLabeledToolRow
        icon={<ToolIcon icon="canvas" className="size-3 shrink-0 text-muted-foreground" />}
        label={isStreaming ? t('chat.toolBlock.generatingWidget') : t('chat.toolBlock.generateWidget')}
        streaming={isStreaming}
      />
    )
  }

  return (
    <GenericToolRowPresenter
      toolName={toolName}
      toolUseId={toolUseId}
      input={input}
      toolSummary={toolSummary}
      status={status}
      elapsedSeconds={elapsedSeconds}
      result={result}
      isError={isError}
      autoExpand={autoExpand}
      allowExpand={allowExpand}
      defaultAutoExpand={defaultAutoExpand}
      autoExpandFileDiffs={autoExpandFileDiffs}
      ports={ports}
    />
  )
})

/** Debug view showing raw input and output for a tool call. */
export function DebugToolBlock({
  toolName,
  input,
  result,
  status,
  elapsedSeconds,
}: {
  toolName: string
  input: string
  result?: string
  status?: 'streaming' | 'complete'
  elapsedSeconds?: number
}) {
  const isStreaming = status === 'streaming'
  const prettyInput = tryPrettifyJson(input) ?? input

  return (
    <div className="my-0.5 rounded border border-amber-500/30 bg-muted/20">
      <div className="flex items-center gap-1.5 px-2 py-1.5 text-xs">
        <span className="size-3 shrink-0 text-center text-warning">&#9881;</span>
        <ToolName streaming={isStreaming} className="text-warning">
          {isStreaming ? <>{getToolVerb(toolName)}…</> : toolName}
        </ToolName>
        <span className="rounded bg-warning/20 px-1 py-px text-xs text-warning">debug</span>
        {isStreaming && elapsedSeconds != null && elapsedSeconds >= 1 && (
          <span className="ml-auto shrink-0 text-muted-foreground">{Math.round(elapsedSeconds)}s</span>
        )}
      </div>
      <div className="px-2 pb-1.5 space-y-1.5">
        <div>
          <div className="mb-0.5 text-xs font-medium uppercase text-muted-foreground">Input</div>
          <div className="max-h-48 overflow-auto rounded bg-background/70 px-2 py-1.5 font-mono text-xs leading-relaxed text-foreground whitespace-pre-wrap break-all">
            {prettyInput || <span className="text-muted-foreground italic">empty</span>}
          </div>
        </div>
        {result && !isStreaming && (
          <div>
            <div className="mb-0.5 text-xs font-medium uppercase text-muted-foreground">Output</div>
            <div className="max-h-48 overflow-auto rounded bg-background/70 px-2 py-1.5 font-mono text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap break-all">
              {result}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
