import { PortableCodexCommand } from './PortableCodexCommand'
import { DeferredInteractiveTool, isPortableInteractiveTool } from './DeferredInteractiveTool'
import { DeferredTool, DeferredCodexTool, DeferredDetailStatus, useDeferredToolDetail } from './DeferredTool'
import { PortableAsyncQuestion, AsyncQuestionTurnContext } from './PortableAsyncQuestion'
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import type {
  ChatMessage,
  CodexCollabToolCallItem,
  CodexMcpToolCallItem,
  ContentBlock,
} from '@superone/shared/agent-types'
import { applyDescriptionPersonaLabel, isAlwaysHiddenToolName, isSubagentToolName, parseMcpToolName } from '@superone/shared/tool-ui'
import { resolveMcpServerIconFromMap } from '@superone/shared/mcp-server-icon'
import { isHiddenToolBlock } from './presenters/tool-display'
import { resolveMarkdownFileLinks } from './presenters/markdown-file-links'
import {
  Check,
  FileText,
  ImageIcon,
  Puzzle,
  ScanSearch,
  TriangleAlert,
} from 'lucide-react'
import { requestNative } from './bridge'
import {
  PortableTurnContext,
  type PendingPermission,
  type PortableTurnContextValue,
} from './portable-turn-context'
import { PortablePlanActions } from './PortablePlanActions'
import { PortableMarkdown, PortableInsight, PlainCode } from './PortableMarkdown'
import { PortableImageGallery, PortableVideoGallery } from './PortableMediaGalleries'
export { PortableImageGallery, PortableVideoGallery } from './PortableMediaGalleries'
import { PortableToolRow } from './PortableToolRow'
import {
  ClaudeTurnBodyPresenter,
  type ClaudeAppToolGroupPresenterProps,
  type ClaudeSubagentPresenterProps,
  type ClaudeToolGroupPresenterProps,
  type ClaudeToolPresenterProps,
  type ClaudeTurnBodyPresenterParts,
  type ClaudeTurnBodyPresenterRuntime,
  type ClaudeWorkflowPresenterProps,
} from './presenters/ClaudeTurnBody'
import {
  CodexTurnViewPresenter,
  codexMcpItemResultText,
  isHiddenCodexMcpItem,
  type CodexItemPresenterProps,
  type CodexSubagentPresenterProps,
  type CodexTurnViewPresenterParts,
  type CodexTurnViewPresenterRuntime,
} from './presenters/CodexTurnView'
import {
  isClaudePinnedSegment,
  isCodexPinnedSegment,
} from './presenters/compact-chat-mode'
import { groupContentPresenter, type GroupContentPorts } from './presenters/groupContent'
import { DeferredReasoning } from './DeferredReasoning'
import { CodexPlanBlockPresenter } from './presenters/CodexPlanBlock'
import {
  CodexCollabBlockPresenter,
  CodexCollabMiniTool,
  codexCollabViewModel,
} from './presenters/CodexCollabBlock'
import { EnterPlanModeBlock, ExitPlanModeBlockPresenter } from './presenters/PlanModeBlocks'
import { ImageGenToolBlockPresenter } from './presenters/ImageGenToolBlock'
import { VideoGenToolBlockPresenter } from './presenters/VideoGenToolBlock'
import { ListAgentsToolBlockPresenter } from './presenters/ListAgentsToolBlock'
import { ReportFindingsToolBlockPresenter } from './presenters/ReportFindingsToolBlock'
import {
  AutomationToolBlockPresenter,
  isAutomationToolName,
} from './presenters/AutomationToolBlock'
import { ConfigApplyBlockPresenter } from './presenters/ConfigApplyBlock'
import { MediaProvidersBlockPresenter } from './presenters/MediaProvidersBlock'
import {
  SessionArchiveToolBlockPresenter,
  isSessionArchiveToolName,
} from './presenters/SessionArchiveToolBlock'
import {
  COLLAB_TOOLS,
  SessionCollabToolBlockPresenter,
} from './presenters/SessionCollabToolBlock'
import {
  PortableBrowserTool,
  PortableComputerTool,
  PortableDeviceTool,
  PortableTerminalTool,
  portableBrowserOp,
  portableComputerOp,
  portableDeviceOp,
  portableTerminalOp,
} from './PortableInteractiveTools'
import {
  SubagentBlockPresenter,
  SubagentScrollArea,
} from './presenters/SubagentBlock'
import { getSubagentColorClasses, portableSubagentColorIndex } from './presenters/subagent-colors'
import { summarizeClaudeProcess, summarizeCodexProcess } from './presenters/turn-process-stats'
import { SetupMiniAppDevBlockPresenter } from './presenters/SetupMiniAppDevBlock'
import { SuperoneCompactToolRowPresenter } from './presenters/SuperoneCompactToolRow'
import { superoneToolDescriptor } from './presenters/superone-tool-display'
import { ToolGroupPresenter } from './presenters/ToolGroup'
import { WorkflowBlockPresenter } from './presenters/WorkflowBlock'
import { parseWorkflowLaunch, stripWorkflowNamePrefix, workflowToolTargetLabel } from './presenters/workflow-utils'
import { TurnDetailSection } from './TurnDetailSection'

/** Same pool and draw as the desktop store, keyed the way each card keys it there. */
function usePortableSubagentColors(key: string) {
  return useMemo(() => getSubagentColorClasses(key ? portableSubagentColorIndex(key) : undefined), [key])
}

const EMPTY_MAP = new Map<string, string>()

function parseRecord(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function stringify(value: unknown): string {
  try { return JSON.stringify(value, null, 2) } catch { return String(value) }
}

function formatTokens(tokens: number): string {
  if (tokens < 1_000) return String(tokens)
  if (tokens < 1_000_000) return `${(tokens / 1_000).toFixed(tokens < 10_000 ? 1 : 0)}k`
  return `${(tokens / 1_000_000).toFixed(1)}m`
}

function isWidgetShowTool(toolName: string): boolean {
  return toolName === 'widget_show' || toolName.endsWith('__widget_show')
}

function isWorkflowSmokeCheck(input: string): boolean {
  const parsed = parseRecord(input)
  return parsed.validate_only === true
    || parsed.validateOnly === true
    || /"(?:validate_only|validateOnly)"\s*:\s*true/.test(input)
}

function toolResultMap(blocks: ContentBlock[]): Map<string, { result: string; isError: boolean }> {
  const results = new Map<string, { result: string; isError: boolean }>()
  for (const block of blocks) {
    if (block.type === 'tool_result') {
      results.set(block.toolUseId, { result: block.summary, isError: Boolean(block.isError) })
    } else if (block.type === 'bash_result' || block.type === 'todo_result') {
      results.set(block.toolUseId, { result: block.summary, isError: false })
    }
  }
  return results
}

function isPermissionPending(permission: PendingPermission, toolUseId?: string, toolName?: string): boolean {
  if (!permission) return false
  return permission.toolUseId ? permission.toolUseId === toolUseId : permission.toolName === toolName
}

function PortableText({ text, isStreaming, afterThinking }: {
  text: string
  isStreaming: boolean
  afterThinking?: boolean
}) {
  const { scheme, projectPath } = useContext(PortableTurnContext)
  // Same pre-parse rewrite the desktop does. Without it a project-relative
  // citation never survives `rehype-harden` to reach the file chip.
  const resolved = useMemo(
    () => (projectPath ? resolveMarkdownFileLinks(text, projectPath) : text),
    [text, projectPath],
  )
  return (
    <div className={afterThinking ? 'mt-1 after-thinking' : undefined}>
      <PortableMarkdown text={resolved} isStreaming={isStreaming} scheme={scheme} />
    </div>
  )
}

function PortableInsightBlock({ title, content, isStreaming }: {
  title: string
  content: string
  isStreaming: boolean
}) {
  const { scheme } = useContext(PortableTurnContext)
  return <PortableInsight title={title} content={content} isStreaming={isStreaming} scheme={scheme} />
}

function PortableDocument({ name }: { name: string }) {
  return <FileText className="size-3 shrink-0" aria-label={name} />
}

function PortableClaudeTool(props: ClaudeToolPresenterProps) {
  const { pendingPermission, mcpIcons } = useContext(PortableTurnContext)
  const brandIconSrc = resolveMcpServerIconFromMap('superone', mcpIcons)
  if (isPortableInteractiveTool(props.toolName, props.input)) return <DeferredInteractiveTool {...props} />
  if (props.remoteDetail) {
    // Dedicated presenters own their chrome — same contract as DeferredInteractiveTool
    // and PortableSubagent. Nesting them in DeferredTool painted a generic
    // `superone · session list` shell around the real row (Grok/Cursor/Claude on the phone).
    if (renderDedicatedTool(props, brandIconSrc) !== null) {
      return <DeferredDedicatedClaudeTool {...props} brandIconSrc={brandIconSrc} />
    }
    return <DeferredTool {...props} remoteDetail={props.remoteDetail} />
  }
  const dedicated = renderDedicatedTool(props, brandIconSrc)
  if (dedicated) return dedicated
  const awaitingPermission = isPermissionPending(pendingPermission, props.toolUseId, props.toolName)
  const row = <PortableToolRow {...props} />
  // The desktop surfaces a pending approval as its own prompt block; the phone marks the row.
  return awaitingPermission
    ? <div data-permission-pending="true" className="rounded ring-1 ring-inset ring-primary/30">{row}</div>
    : row
}

/**
 * Progressive-loading shell for a tool that has its own presenter. Fetches the
 * projected detail on mount so the dedicated row can show its real header
 * (`Sessions Listed`, `Settings Read`, …) instead of a generic MCP fallback.
 */
function DeferredDedicatedClaudeTool({
  brandIconSrc,
  ...props
}: ClaudeToolPresenterProps & { brandIconSrc?: string }) {
  const complete = props.status !== 'streaming'
  const { detail, text, error, status, retry } = useDeferredToolDetail(props.remoteDetail, true, complete)
  const ready = Boolean(text) || Boolean(error)
  const merged: ClaudeToolPresenterProps = {
    ...props,
    ...detail,
    remoteDetail: undefined,
    // Keep the dedicated chrome in its in-flight state until the payload lands —
    // otherwise session_list flashes "0 sessions" from an empty parse.
    status: ready ? props.status : 'streaming',
  }
  return (
    <>
      {renderDedicatedTool(merged, brandIconSrc)}
      <DeferredDetailStatus status={error ? status : undefined} onRetry={retry} />
    </>
  )
}

/**
 * Presenters that replace the generic tool row for a given tool. Returns `null` when the tool has
 * none and must render as `PortableToolRow`. The deferred path uses that answer to choose
 * `DeferredDedicatedClaudeTool` (own chrome) vs `DeferredTool` (generic row, result in-place).
 */
function renderDedicatedTool(props: ClaudeToolPresenterProps, brandIconSrc?: string): ReactNode | null {
  const browserOp = portableBrowserOp(props.toolName, props.input)
  const computerOp = portableComputerOp(props.toolName)
  const deviceOp = portableDeviceOp(props.toolName)
  const terminalOp = portableTerminalOp(props.toolName)
  const mcpInfo = parseMcpToolName(props.toolName)
  const collabToolName = mcpInfo?.serverName === 'superone' ? mcpInfo.mcpToolName : null
  if (props.toolName === 'EnterPlanMode') return <EnterPlanModeBlock />
  if (props.toolName === 'ExitPlanMode') return <ExitPlanModeBlockPresenter result={props.result} />
  if (props.toolName === 'ListAgents') {
    const isDenied = Boolean(props.result?.startsWith('[denied] '))
    return (
      <ListAgentsToolBlockPresenter
        result={isDenied ? undefined : props.result}
        isStreaming={props.status === 'streaming'}
        isError={props.isError}
        isDenied={isDenied}
      />
    )
  }
  if (props.toolName === 'ReportFindings') {
    const isDenied = Boolean(props.result?.startsWith('[denied] '))
    return (
      <ReportFindingsToolBlockPresenter
        params={parseRecord(props.input)}
        isStreaming={props.status === 'streaming'}
        isError={props.isError}
        isDenied={isDenied}
        elapsedSeconds={props.elapsedSeconds}
        renderFile={(finding) => (
          <button
            type="button"
            className="max-w-56 truncate rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-primary"
            title={finding.line != null ? `${finding.file}:${finding.line}` : finding.file}
            onClick={() => requestNative('previewFile', { path: finding.file, ...(finding.line != null ? { line: finding.line } : {}) })}
            aria-label={`Open ${finding.file}`}
          >
            {finding.file.split('/').pop() || finding.file}
          </button>
        )}
      />
    )
  }
  if (collabToolName && COLLAB_TOOLS.has(collabToolName)) {
    const isDenied = Boolean(props.result?.startsWith('[denied] '))
    return (
      <SessionCollabToolBlockPresenter
        toolName={collabToolName}
        params={parseRecord(props.input)}
        result={isDenied ? props.result?.slice('[denied] '.length) : props.result}
        isStreaming={props.status === 'streaming'}
        isError={props.isError}
        isDenied={isDenied}
        renderMarkdown={(content) => <PortableText text={content} isStreaming={false} />}
      />
    )
  }
  if (collabToolName === 'media_list_providers') {
    const isDenied = Boolean(props.result?.startsWith('[denied] '))
    return (
      <MediaProvidersBlockPresenter
        result={isDenied ? null : props.result ?? null}
        isStreaming={props.status === 'streaming'}
        isError={props.isError}
        isDenied={isDenied}
      />
    )
  }
  if (collabToolName === 'config_apply') {
    const isDenied = Boolean(props.result?.startsWith('[denied] '))
    return (
      <ConfigApplyBlockPresenter
        params={parseRecord(props.input)}
        result={isDenied ? props.result?.slice('[denied] '.length) ?? null : props.result ?? null}
        isStreaming={props.status === 'streaming'}
        isError={Boolean(props.isError)}
        isDenied={isDenied}
        allowExpand
      />
    )
  }
  if (collabToolName && isSessionArchiveToolName(collabToolName)) {
    const isDenied = Boolean(props.result?.startsWith('[denied] '))
    return (
      <SessionArchiveToolBlockPresenter
        toolName={collabToolName}
        params={parseRecord(props.input)}
        result={isDenied ? props.result?.slice('[denied] '.length) : props.result}
        isStreaming={props.status === 'streaming'}
        isError={props.isError}
        isDenied={isDenied}
      />
    )
  }
  if (collabToolName && isAutomationToolName(collabToolName)) {
    const isDenied = Boolean(props.result?.startsWith('[denied] '))
    return (
      <AutomationToolBlockPresenter
        toolName={collabToolName}
        params={parseRecord(props.input)}
        result={isDenied ? props.result?.slice('[denied] '.length) : props.result}
        isStreaming={props.status === 'streaming'}
        isError={props.isError}
        isDenied={isDenied}
      />
    )
  }
  if (collabToolName === 'miniapp_dev_setup') {
    const isDenied = Boolean(props.result?.startsWith('[denied] '))
    const params = parseRecord(props.input)
    return (
      <SetupMiniAppDevBlockPresenter
        appName={typeof params.name === 'string' ? params.name : ''}
        params={params}
        // The phone's tool_result is truncated at 200 chars, so a longer setup payload
        // parses to nothing and the card simply shows the fields the input already carries.
        result={props.status === 'streaming' || isDenied || !props.result ? null : parseRecord(props.result)}
        isStreaming={props.status === 'streaming'}
        isError={props.isError}
        isDenied={isDenied}
        allowExpand
      />
    )
  }
  // Every SuperOne tool whose UI is a verb and a subject. Placed after the richer
  // blocks above so a tool that has both keeps the richer one, and before the
  // browser/device families so it never shadows an op-driven row.
  if (collabToolName && superoneToolDescriptor(collabToolName)) {
    const isDenied = Boolean(props.result?.startsWith('[denied] '))
    return (
      <SuperoneCompactToolRowPresenter
        mcpToolName={collabToolName}
        params={parseRecord(props.input)}
        result={props.result ?? null}
        isStreaming={props.status === 'streaming'}
        isError={props.isError}
        isDenied={isDenied}
        brandIconSrc={brandIconSrc}
      />
    )
  }
  if (browserOp) {
    return (
      <PortableBrowserTool
        op={browserOp}
        input={props.input}
        result={props.result}
        toolSummary={props.toolSummary}
        isStreaming={props.status === 'streaming'}
        isError={props.isError}
      />
    )
  }
  if (computerOp) {
    return (
      <PortableComputerTool
        op={computerOp}
        input={props.input}
        result={props.result}
        toolSummary={props.toolSummary}
        isStreaming={props.status === 'streaming'}
        isError={props.isError}
      />
    )
  }
  if (deviceOp) {
    return (
      <PortableDeviceTool
        op={deviceOp}
        input={props.input}
        result={props.result}
        toolSummary={props.toolSummary}
        isStreaming={props.status === 'streaming'}
        isError={props.isError}
      />
    )
  }
  if (terminalOp) {
    return (
      <PortableTerminalTool
        op={terminalOp}
        input={props.input}
        result={props.result}
        toolSummary={props.toolSummary}
        isStreaming={props.status === 'streaming'}
        isError={props.isError}
      />
    )
  }
  if (isImageGenerationTool(props.toolName)) {
    return (
      <PortableImageGenTool
        input={props.input}
        result={props.result}
        isStreaming={props.status === 'streaming'}
        isError={props.isError}
      />
    )
  }
  if (isVideoGenerationTool(props.toolName) && !props.result?.startsWith('[denied] ')) {
    return (
      <PortableVideoGenTool
        input={props.input}
        result={props.result}
        isStreaming={props.status === 'streaming'}
        isError={props.isError}
      />
    )
  }
  return null
}

function isImageGenerationTool(toolName: string): boolean {
  return toolName === 'mcp__superone__media_generate_image'
    || ['ImageGen', 'ImageEdit', 'image_gen', 'image_edit'].includes(toolName)
}

function isVideoGenerationTool(toolName: string): boolean {
  return toolName === 'mcp__superone__media_generate_video'
    || ['ImageToVideo', 'ReferenceToVideo', 'image_to_video', 'reference_to_video'].includes(toolName)
}

function PortableImageGenTool({
  input,
  result,
  isStreaming,
  isError,
}: {
  input: string
  result?: string
  isStreaming: boolean
  isError?: boolean
}) {
  return (
    <ImageGenToolBlockPresenter
      params={parseRecord(input)}
      result={result}
      isStreaming={isStreaming}
      isError={isError}
      isDenied={Boolean(result?.startsWith('[denied] '))}
      renderReferenceImage={(path, label) => (
        <button
          key={path}
          type="button"
          className="flex w-16 flex-none flex-col items-center gap-1"
          onClick={() => requestNative('previewFile', { path })}
          aria-label={`Preview ${label}`}
        >
          <span className="flex size-16 items-center justify-center rounded-md border border-border bg-muted/30">
            <ImageIcon className="size-4 text-muted-foreground" />
          </span>
          <span className="max-w-16 truncate text-xs text-muted-foreground">{label}</span>
        </button>
      )}
    />
  )
}

function PortableVideoGenTool({
  input,
  result,
  isStreaming,
  isError,
}: {
  input: string
  result?: string
  isStreaming: boolean
  isError?: boolean
}) {
  const preview = (path: string, label: string) => (
    <button
      key={path}
      type="button"
      className="flex items-center gap-1.5 text-xs text-primary"
      onClick={() => requestNative('previewFile', { path })}
      aria-label={`Preview ${label}`}
    >
      <ImageIcon className="size-3.5" />
      <span className="max-w-48 truncate">{path.split('/').pop() || label}</span>
    </button>
  )
  return (
    <VideoGenToolBlockPresenter
      params={parseRecord(input)}
      result={result}
      isStreaming={isStreaming}
      isError={isError}
      renderImageRef={preview}
      renderFileRef={(path, label) => preview(path, label)}
    />
  )
}

function toolVerb(toolName: string): string {
  if (toolName === 'Read') return 'Reading'
  if (toolName === 'Glob' || toolName === 'Grep' || toolName === 'WebSearch') return 'Searching'
  if (toolName === 'WebFetch') return 'Fetching'
  return 'Running'
}

function PortableToolGroup({ blocks, sealed }: ClaudeToolGroupPresenterProps) {
  const results = useMemo(() => toolResultMap(blocks), [blocks])
  return (
    <ToolGroupPresenter
      blocks={blocks}
      sealed={sealed}
      getToolVerb={toolVerb}
      renderTool={(block, index) => {
        const result = results.get(block.toolUseId)
        return (
          <PortableClaudeTool
            key={`${block.toolUseId}-${index}`}
            remoteDetail={block.remoteDetail}
            toolName={block.toolName}
            toolUseId={block.toolUseId}
            input={block.input}
            toolSummary={block.toolSummary}
            status={block.status}
            elapsedSeconds={block.elapsedSeconds}
            result={result?.result}
            isError={result?.isError}
            toolDiff={block.toolDiff}
            toolDiffTokens={block.toolDiffTokens}
            toolLineDelta={block.toolLineDelta}
          />
        )
      }}
    />
  )
}

function PortableAppToolGroup({ blocks, sealed }: ClaudeAppToolGroupPresenterProps) {
  return <PortableToolGroup blocks={blocks} sealed={sealed} />
}

function portableTaskInput(input: string, toolSummary?: string) {
  const params = parseRecord(input)
  // A progressive projection keeps the header fields but drops `prompt` once the
  // input passes the size cap; older shells blanked it all and left only the
  // agent-written description as `toolSummary`, so keep that fallback.
  const labeled = applyDescriptionPersonaLabel(
    String(params.description ?? '') || toolSummary || '',
    String(params.subagent_type ?? params.subagentType ?? ''),
  )
  return {
    name: String(params.name ?? params.agent_name ?? ''),
    teamName: String(params.team_name ?? params.teamName ?? ''),
    description: labeled.description,
    subagentType: labeled.subagentType,
    prompt: String(params.prompt ?? ''),
    model: typeof params.model === 'string' ? params.model : undefined,
  }
}

/**
 * Subagent card for the phone. Under progressive loading the transcript carries only
 * the collapsed shell (`remoteDetail`); the prompt, child tool rows and result are
 * fetched when the card itself is expanded, so the card stays the single chrome —
 * the desktop never wraps a subagent in a generic tool row and neither does this.
 */
function PortableSubagent({
  taskBlock,
  childBlocks: shellChildBlocks,
  resultBlock: shellResultBlock,
  isStreaming,
}: ClaudeSubagentPresenterProps) {
  const [expanded, setExpanded] = useState(false)
  const colors = usePortableSubagentColors(taskBlock.toolUseId)
  const shellComplete = Boolean(shellResultBlock || taskBlock.taskResultText)
  const { detail, status: detailStatus, retry } = useDeferredToolDetail(taskBlock.remoteDetail, expanded, shellComplete || !isStreaming)
  const input = detail.input ?? taskBlock.input
  const childBlocks = detail.childBlocks ?? shellChildBlocks
  const resultBlock: ContentBlock | undefined = detail.result
    ? { type: 'tool_result', toolUseId: taskBlock.toolUseId, summary: detail.result }
    : shellResultBlock
  const result = resultBlock?.type === 'tool_result' ? resultBlock : undefined
  const complete = Boolean(resultBlock || taskBlock.taskResultText)
  const failed = Boolean(result?.isError)
  const children = useMemo(() => {
    const results = toolResultMap(childBlocks)
    return childBlocks.flatMap((block, index): ReactNode[] => {
      if (block.type !== 'tool_use') return []
      const childResult = results.get(block.toolUseId)
      if (block.remoteDetail) return [<DeferredTool key={`${block.toolUseId}-${index}`} remoteDetail={block.remoteDetail}
        toolName={block.toolName} toolUseId={block.toolUseId} input={block.input} status={block.status}
        toolSummary={block.toolSummary} filePath={block.toolFilePath} toolLineDelta={block.toolLineDelta} />]
      return [(
        <PortableToolRow
          key={`${block.toolUseId}-${index}`}
          toolName={block.toolName}
          toolUseId={block.toolUseId}
          input={block.input}
          toolSummary={block.toolSummary}
          status={block.status}
          result={childResult?.result}
          isError={childResult?.isError}
          toolDiff={block.toolDiff}
          toolDiffTokens={block.toolDiffTokens}
          toolLineDelta={block.toolLineDelta}
        />
      )]
    })
  }, [childBlocks])
  const completionElapsed = childBlocks.reduce((maximum, block) => (
    block.type === 'tool_use' && block.elapsedSeconds
      ? Math.max(maximum, block.elapsedSeconds)
      : maximum
  ), 0)
  return (
    <SubagentBlockPresenter
      toolUseId={taskBlock.toolUseId}
      taskInput={portableTaskInput(input, taskBlock.toolSummary)}
      colors={colors}
      isAsync={false}
      isRunning={!complete && isStreaming}
      isComplete={complete}
      isFailed={failed}
      isStopped={false}
      expanded={expanded}
      onExpandedChange={setExpanded}
      canOpenFullView={false}
      onOpenFullView={() => undefined}
      initialElapsed={0}
      completionElapsed={completionElapsed}
      stats={{
        // Collapsed, the shell has no children: the badge reads the task's own usage, like the desktop.
        toolCalls: children.length > 0 ? children.length : taskBlock.taskUsage?.toolUses ?? 0,
        totalTokens: taskBlock.taskUsage?.totalTokens,
      }}
      activityContent={<DeferredDetailStatus status={detailStatus} onRetry={retry} />}
      childContent={children.length > 0 ? (
        <SubagentScrollArea maxHeightClass="max-h-60" className="space-y-0.5 px-2 py-1">
          {children}
        </SubagentScrollArea>
      ) : undefined}
      diagnostic={failed ? result?.summary : undefined}
      resultText={!failed ? (result?.summary ?? taskBlock.taskResultText) : undefined}
      formatTokens={formatTokens}
      Markdown={({ text }) => <PortableText text={text} isStreaming={false} />}
    />
  )
}

/**
 * Workflow card for the phone. Same presenter as the desktop card, fed from the
 * tool block alone: the desktop reads `taskProgress` and the run directory on
 * disk, neither of which exists here, so every fact it derives from those must
 * already have been patched onto the block (`taskStatus`, `workflowAgents`, …).
 *
 * A workflow runs in the background, so its `tool_result` is a launch receipt
 * (run id, script path) that lands seconds after the call — it proves the run
 * started, never that it finished. Completion is `taskStatus`; the receipt is
 * only shown when the launch itself failed.
 */
function PortableWorkflow({ toolBlock, resultBlock: shellResultBlock, isStreaming }: ClaudeWorkflowPresenterProps) {
  const [expanded, setExpanded] = useState(false)
  const colors = usePortableSubagentColors(toolBlock.toolUseId)
  const finished = !!toolBlock.taskStatus
  const { detail } = useDeferredToolDetail(toolBlock.remoteDetail, expanded, finished)
  const input = detail.input ?? toolBlock.input
  const resultBlock: ContentBlock | undefined = detail.result
    ? { type: 'tool_result', toolUseId: toolBlock.toolUseId, summary: detail.result }
    : shellResultBlock
  const result = resultBlock?.type === 'tool_result' ? resultBlock : undefined
  const launch = parseWorkflowLaunch(result?.summary)
  const launchFailed = !!result?.isError
  const launched = !launchFailed && (!!(launch.runId ?? launch.taskId) || !!toolBlock.taskSummary || !!toolBlock.taskUsage)
  const isComplete = finished || launchFailed
  const isRunning = !isComplete && (launched || isStreaming)
  const name = toolBlock.workflowName || launch.name || workflowToolTargetLabel(input) || undefined
  const description = stripWorkflowNamePrefix(toolBlock.workflowDescription || toolBlock.taskDescription, name)
  const agents = (toolBlock.workflowAgents ?? []).map((agent, index) => ({
    agentId: agent.agentId ?? `agent-${index}`,
    label: agent.label,
    toolCount: agent.toolCount,
    tokens: agent.tokens,
    state: agent.state,
  }))
  const agentsTokens = agents.reduce((sum, agent) => sum + (agent.tokens ?? 0), 0)
  const summary = stripWorkflowNamePrefix(toolBlock.taskSummary, name)
  return (
    <WorkflowBlockPresenter
      colors={colors}
      name={name}
      description={description}
      isSpawning={!launched && !isComplete && !name}
      isRunning={isRunning}
      isComplete={isComplete}
      terminalStatus={toolBlock.taskStatus ?? (launchFailed ? 'failed' : undefined)}
      activePhase={isRunning ? toolBlock.workflowCurrentPhase : undefined}
      phases={toolBlock.workflowPhases ?? []}
      agents={agents}
      totalTokens={toolBlock.taskUsage?.totalTokens || agentsTokens}
      elapsed={toolBlock.taskUsage?.durationMs ? Math.round(toolBlock.taskUsage.durationMs / 1000) : 0}
      expanded={expanded}
      onExpandedChange={setExpanded}
      canOpenFullView={false}
      onOpenFullView={() => undefined}
      logs={[]}
      resultText={launchFailed ? result?.summary : (toolBlock.taskResultText ?? detail.taskResultText)}
      runningSummary={summary}
      terminalSummary={summary}
      formatTokens={formatTokens}
      StructuredOutput={({ data }) => <PlainCode>{data}</PlainCode>}
    />
  )
}

const GROUP_PORTS: GroupContentPorts = {
  isSubagentToolName,
  isWorkflowSmokeCheck,
  isHiddenToolBlock,
  resolveAppTool: () => null,
}

const CLAUDE_PARTS: ClaudeTurnBodyPresenterParts = {
  Text: PortableText,
  Insight: PortableInsightBlock,
  Document: PortableDocument,
  Tool: PortableClaudeTool,
  Reasoning: DeferredReasoning,
  Subagent: PortableSubagent,
  Workflow: PortableWorkflow,
  ToolGroup: PortableToolGroup,
  AppToolGroup: PortableAppToolGroup,
  TurnDetail: TurnDetailSection,
}

const CLAUDE_RUNTIME: ClaudeTurnBodyPresenterRuntime = {
  isBackgroundTool(block) {
    const params = parseRecord(block.input)
    return block.toolName === 'Bash' && (params.run_in_background === true || params.background === true)
  },
  isPinnedSegment: (segment) => isClaudePinnedSegment(segment, { isWidgetShowTool }),
  isHiddenTool: isHiddenToolBlock,
  summarizeProcess: summarizeClaudeProcess,
}

/**
 * Remote turns carry harness-specific block types (`bash`, `todo`) that the
 * shared grouping and gallery collectors only recognise as `tool_use`. Exported
 * so the turn body and the turn-end galleries normalise identically — collecting
 * from raw content would silently find no generated images.
 */
export function portableToolBlocks(content: ContentBlock[]): ContentBlock[] {
  return content.map((block): ContentBlock => (
    'toolName' in block && block.type !== 'tool_use'
      ? { ...block, type: 'tool_use' }
      : block
  ))
}

/** Tool result text by tool-use id, the shape the gallery collectors expect. */
export function portableToolResultText(content: ContentBlock[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const block of content) {
    if (block.type === 'tool_result' && block.summary) map.set(block.toolUseId, block.summary)
  }
  return map
}

export function PortableClaudeTurn({
  message,
  isStreaming,
}: {
  message: ChatMessage
  isStreaming: boolean
}) {
  const portableContent = useMemo(() => portableToolBlocks(message.content), [message.content])
  const grouped = useMemo(() => groupContentPresenter(portableContent, GROUP_PORTS), [portableContent])
  return (
    <ClaudeTurnBodyPresenter
      grouped={grouped}
      isStreaming={isStreaming}
      detailChatMode={false}
      // Desktop resolves project-relative media through this; the WebView has no
      // transport for host files, so markdown srcs stay as written. File LINKS
      // still resolve — through `projectPath` on PortableTurnContext.
      projectPath={null}
      parts={CLAUDE_PARTS}
      runtime={CLAUDE_RUNTIME}
    />
  )
}

function PortableCodexMarkdown({ text, isStreaming }: { text: string; isStreaming: boolean }) {
  return <PortableText text={text} isStreaming={isStreaming} />
}

function PortablePlan({
  item,
  isStreaming,
  nextItem,
  onApprovePlan,
  onRejectPlan,
  planApproval,
}: CodexItemPresenterProps) {
  if (item.type !== 'plan') return null
  return (
    <CodexPlanBlockPresenter
      item={item}
      isStreaming={isStreaming}
      hasFollowingItem={Boolean(nextItem)}
      planApproval={planApproval}
      onApprovePlan={onApprovePlan}
      onRejectPlan={onRejectPlan}
      renderApprovalActions={(actions) => <PortablePlanActions {...actions} />}
      Markdown={PortableCodexMarkdown}
    />
  )
}

function claudePropsFromCodexMcp(item: CodexMcpToolCallItem): ClaudeToolPresenterProps {
  return {
    toolName: `mcp__${item.server}__${item.tool}`,
    toolUseId: item.id,
    input: typeof item.arguments === 'string' ? item.arguments : stringify(item.arguments ?? {}),
    result: codexMcpItemResultText(item),
    status: item.status === 'in_progress' ? 'streaming' : 'complete',
    isError: item.status === 'failed' || Boolean(item.error),
  }
}

/**
 * Codex MCP detail is item-shaped (`{ item, input, result }`), not the Claude
 * `{ input, result }` payload `DeferredDedicatedClaudeTool` reads. Fetch here,
 * then hand the loaded call to `PortableClaudeTool` with no `remoteDetail` so
 * the dedicated presenter is the chrome — never a generic row wrapping it.
 */
function DeferredCodexMcp({ item }: { item: CodexMcpToolCallItem }) {
  const complete = item.status !== 'in_progress'
  const { detail, text, error, status, retry } = useDeferredToolDetail(item.remoteDetail, true, complete)
  const loaded = detail.item?.type === 'mcp_tool_call' ? detail.item : null
  const ready = Boolean(text) || Boolean(error)
  const src = loaded ?? item
  return (
    <>
      <PortableClaudeTool
        {...claudePropsFromCodexMcp(src)}
        status={!ready || src.status === 'in_progress' ? 'streaming' : 'complete'}
      />
      <DeferredDetailStatus status={error ? status : undefined} onRetry={retry} />
    </>
  )
}

function PortableCodexItem(props: CodexItemPresenterProps) {
  const { item, index, isStreaming } = props
  if (item.type === 'mcp_tool_call') {
    if (item.remoteDetail) return <DeferredCodexMcp item={item} />
    return <PortableClaudeTool {...claudePropsFromCodexMcp(item)} />
  }
  if ('remoteDetail' in item && item.remoteDetail) return <DeferredCodexTool item={item} isStreaming={isStreaming} />
  switch (item.type) {
    case 'command_execution':
      return <PortableCodexCommand item={item} isStreaming={isStreaming} />
    case 'agent_message':
      return item.questions?.length ? <PortableAsyncQuestion item={item} /> : <div className="my-0.5"><PortableCodexMarkdown text={item.text} isStreaming={isStreaming} /></div>
    case 'plan':
      return <PortablePlan {...props} />
    case 'review':
      return (
        <div className="my-1 flex items-center gap-2 rounded bg-primary/10 px-2.5 py-1.5 text-xs text-primary">
          {item.phase === 'entered' ? <ScanSearch className="size-3.5" /> : <Check className="size-3.5" />}
          <span>{item.text || (item.phase === 'entered' ? 'Review started' : 'Review complete')}</span>
        </div>
      )
    case 'file_change':
      return (
        <div className="my-0.5 space-y-0.5">
          {(item.changes.length ? item.changes : [{ path: '', kind: 'update' as const }]).map((change, changeIndex) => (
            <PortableToolRow
              key={`${item.id}-${changeIndex}`}
              toolName="FileChange"
              toolUseId={`${item.id}-${changeIndex}`}
              input={stringify({ file_path: change.path, kind: change.kind, diff: change.diff ?? '' })}
              status="complete"
              result={item.status === 'failed' && changeIndex === 0 ? 'Failed to apply file changes.' : undefined}
              isError={item.status === 'failed'}
            />
          ))}
        </div>
      )
    case 'web_search':
      return (
        <PortableToolRow
          toolName="WebSearch"
          toolUseId={item.id}
          input={stringify({ query: item.query })}
          toolSummary={item.query}
          status={item.status === 'in_progress' ? 'streaming' : 'complete'}
          isError={item.status === 'failed'}
        />
      )
    case 'error':
      return (
        <div className="my-0.5 rounded bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
          <TriangleAlert className="mr-1 inline size-3.5" />{item.message}
        </div>
      )
    case 'compaction':
      return <div className="my-0.5 text-xs text-muted-foreground"><Check className="mr-1 inline size-3.5" />Context compacted</div>
    case 'collab_tool_call':
      return (
        <PortableToolRow
          toolName={`Collaboration · ${item.tool}`}
          toolUseId={item.id}
          input={stringify({ receivers: item.receiverThreadIds, prompt: item.prompt })}
          result={stringify(item.agentsStates)}
          status={item.status === 'in_progress' ? 'streaming' : 'complete'}
          isError={item.status === 'failed'}
        />
      )
    default:
      return <div key={`${item.id}-${index}`} />
  }
}

/**
 * Codex collab card for the phone. A projected `collab_tool_call` keeps only the shell
 * (prompt / child items stripped); the full item is fetched on expand and swapped in,
 * so the card is never nested inside a generic tool row.
 */
function PortableCodexSubagent({ item: shellItem }: CodexSubagentPresenterProps) {
  const [expanded, setExpanded] = useState(false)
  const { detail, status: detailStatus, retry } = useDeferredToolDetail(shellItem.remoteDetail, expanded, shellItem.status !== 'in_progress')
  const item = detail.item?.type === 'collab_tool_call' ? detail.item : shellItem
  const view = codexCollabViewModel(item)
  const colors = usePortableSubagentColors(view.colorKey)
  const activityContent = view.activityItems.length > 0 ? (
    <SubagentScrollArea maxHeightClass="max-h-60" className="space-y-0.5 border-t border-border/30 px-2 py-1">
      {view.activityItems.map((child, index) => <CodexCollabMiniTool key={`${child.id}-${index}`} item={child} />)}
    </SubagentScrollArea>
  ) : undefined
  // The collab presenter has a single body slot, so the deferred-load status shares it.
  const childContent = detailStatus || activityContent ? (
    <>
      <DeferredDetailStatus status={detailStatus} onRetry={retry} />
      {activityContent}
    </>
  ) : undefined
  return (
    <CodexCollabBlockPresenter
      item={item}
      colors={colors}
      expanded={expanded}
      onExpandedChange={setExpanded}
      canOpenFullView={false}
      onOpenFullView={() => undefined}
      childContent={childContent}
      formatTokens={formatTokens}
      Markdown={({ text }) => <PortableText text={text} isStreaming={false} />}
    />
  )
}

function PortableAppIcon({ appId, className }: { appId: string; className?: string }) {
  return <Puzzle className={className} aria-label={appId} />
}

const CODEX_PARTS: CodexTurnViewPresenterParts = {
  Markdown: PortableCodexMarkdown,
  CodexItem: PortableCodexItem,
  Command: PortableCodexCommand,
  Subagent: PortableCodexSubagent,
  Reasoning: DeferredReasoning,
  Tool: (props) => props.remoteDetail ? <DeferredTool {...props} remoteDetail={props.remoteDetail} /> : <PortableToolRow {...props} />,
  ImageGallery: PortableImageGallery,
  TurnDetail: TurnDetailSection,
  AppIcon: PortableAppIcon,
}

const CODEX_RUNTIME: CodexTurnViewPresenterRuntime = {
  isHiddenMcpItem: isHiddenCodexMcpItem,
  isSpawnReady: (item: CodexCollabToolCallItem) => item.receiverThreadIds.length > 0,
  isSubagentFollowUp: (item: CodexCollabToolCallItem) => item.tool === 'sendInput' && item.receiverThreadIds.length > 0,
  isPinnedSegment: (segment, itemAt) => isCodexPinnedSegment(segment, itemAt, { isWidgetShowTool }),
  summarizeProcess: summarizeCodexProcess,
}

export function PortableCodexTurn({
  message,
  isStreaming,
  isLastAssistant,
}: {
  message: ChatMessage
  isStreaming: boolean
  isLastAssistant: boolean
}) {
  const respondToPlan = (status: 'approved' | 'rejected', feedback?: string): void => {
    requestNative('codexPlanApproval', {
      messageId: message.id,
      status,
      ...(feedback ? { feedback } : {}),
    })
  }
  return (
    <AsyncQuestionTurnContext.Provider value={message.id}><CodexTurnViewPresenter
      message={message}
      isStreaming={isStreaming}
      isWorking={isStreaming}
      isLastAssistant={isLastAssistant}
      detailChatMode={false}
      canRespondToPlan
      onApprovePlan={() => respondToPlan('approved')}
      onRejectPlan={(feedback) => respondToPlan('rejected', feedback)}
      groupableAppByTool={EMPTY_MAP}
      appNameById={EMPTY_MAP}
      parts={CODEX_PARTS}
      runtime={CODEX_RUNTIME}
    /></AsyncQuestionTurnContext.Provider>
  )
}

export function PortableTurnProvider({
  scheme,
  pendingPermission,
  projectPath,
  mcpIcons = {},
  children,
}: Omit<PortableTurnContextValue, 'mcpIcons'> & { mcpIcons?: Record<string, string>; children: ReactNode }) {
  const value = useMemo(
    () => ({ scheme, pendingPermission, projectPath, mcpIcons }),
    [scheme, pendingPermission, projectPath, mcpIcons],
  )
  return <PortableTurnContext.Provider value={value}>{children}</PortableTurnContext.Provider>
}
