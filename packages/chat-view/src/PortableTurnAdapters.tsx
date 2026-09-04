import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import type {
  ChatMessage,
  CodexCollabToolCallItem,
  ContentBlock,
  ImageGenerationItem,
} from '@superone/shared/agent-types'
import { isAlwaysHiddenToolName, isSubagentToolName } from '@superone/shared/tool-ui'
import {
  Check,
  FileText,
  ImageIcon,
  Puzzle,
  ScanSearch,
  TriangleAlert,
  X,
} from 'lucide-react'
import { requestNative } from './bridge'
import { PortableMarkdown, PlainCode } from './PortableMarkdown'
import { PortableNativeGallery } from './PortableNativeGallery'
import { PortableTool } from './PortableTool'
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
  type CodexCommandPresenterProps,
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
import { ReasoningBlock } from './presenters/ReasoningBlock'
import { CodexPlanBlockPresenter } from './presenters/CodexPlanBlock'
import {
  CodexCollabBlockPresenter,
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
  portableBrowserOp,
  portableComputerOp,
  portableDeviceOp,
} from './PortableInteractiveTools'
import {
  SubagentBlockPresenter,
  type SubagentColorClasses,
} from './presenters/SubagentBlock'
import { summarizeClaudeProcess, summarizeCodexProcess } from './presenters/turn-process-stats'
import { ToolGroupPresenter } from './presenters/ToolGroup'
import { WorkflowBlockPresenter } from './presenters/WorkflowBlock'
import { TurnDetailSection } from './TurnDetailSection'

type PendingPermission = {
  toolUseId?: string
  toolName: string
} | null

interface PortableTurnContextValue {
  scheme: 'light' | 'dark'
  pendingPermission: PendingPermission
}

const PortableTurnContext = createContext<PortableTurnContextValue>({
  scheme: 'dark',
  pendingPermission: null,
})

const PORTABLE_COLORS: SubagentColorClasses = {
  text: 'text-primary',
  tagBg: 'bg-primary/10',
  tagText: 'text-primary',
  activityBg: 'bg-primary/5',
  borderL: 'border-primary/30',
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
  const { scheme } = useContext(PortableTurnContext)
  return (
    <div className={afterThinking ? 'mt-1 after-thinking' : undefined}>
      <PortableMarkdown text={text} isStreaming={isStreaming} scheme={scheme} />
    </div>
  )
}

function PortableDocument({ name }: { name: string }) {
  return <FileText className="size-3 shrink-0" aria-label={name} />
}

function PortableClaudeTool(props: ClaudeToolPresenterProps) {
  const { pendingPermission } = useContext(PortableTurnContext)
  const browserOp = portableBrowserOp(props.toolName, props.input)
  const computerOp = portableComputerOp(props.toolName)
  const deviceOp = portableDeviceOp(props.toolName)
  const collabToolName = props.toolName.startsWith('mcp__superone__')
    ? props.toolName.slice('mcp__superone__'.length)
    : null
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
            onClick={() => requestNative('openFile', { path: finding.file })}
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
  return (
    <PortableTool
      {...props}
      summary={props.toolSummary}
      pendingPermission={isPermissionPending(pendingPermission, props.toolUseId, props.toolName)}
    />
  )
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
            toolName={block.toolName}
            toolUseId={block.toolUseId}
            input={block.input}
            toolSummary={block.toolSummary}
            status={block.status}
            elapsedSeconds={block.elapsedSeconds}
            result={result?.result}
            isError={result?.isError}
          />
        )
      }}
    />
  )
}

function PortableAppToolGroup({ blocks, sealed }: ClaudeAppToolGroupPresenterProps) {
  return <PortableToolGroup blocks={blocks} sealed={sealed} />
}

function portableTaskInput(input: string) {
  const params = parseRecord(input)
  return {
    name: String(params.name ?? params.agent_name ?? ''),
    teamName: String(params.team_name ?? params.teamName ?? ''),
    description: String(params.description ?? ''),
    subagentType: String(params.subagent_type ?? params.subagentType ?? ''),
    prompt: String(params.prompt ?? ''),
    model: typeof params.model === 'string' ? params.model : undefined,
  }
}

function PortableSubagent({
  taskBlock,
  childBlocks,
  resultBlock,
  isStreaming,
}: ClaudeSubagentPresenterProps) {
  const [expanded, setExpanded] = useState(false)
  const result = resultBlock?.type === 'tool_result' ? resultBlock : undefined
  const complete = Boolean(resultBlock || taskBlock.taskResultText)
  const failed = Boolean(result?.isError)
  const children = useMemo(() => {
    const results = toolResultMap(childBlocks)
    return childBlocks.flatMap((block, index): ReactNode[] => {
      if (block.type !== 'tool_use') return []
      const childResult = results.get(block.toolUseId)
      return [(
        <PortableTool
          key={`${block.toolUseId}-${index}`}
          toolName={block.toolName}
          toolUseId={block.toolUseId}
          input={block.input}
          summary={block.toolSummary}
          status={block.status}
          result={childResult?.result}
          isError={childResult?.isError}
          grouped
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
      taskInput={portableTaskInput(taskBlock.input)}
      colors={PORTABLE_COLORS}
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
      stats={{ toolCalls: children.length }}
      childContent={children.length > 0 ? <div className="space-y-0.5 px-2 py-1">{children}</div> : undefined}
      diagnostic={failed ? result?.summary : undefined}
      resultText={!failed ? (result?.summary ?? taskBlock.taskResultText) : undefined}
      formatTokens={formatTokens}
      Markdown={({ text }) => <PortableText text={text} isStreaming={false} />}
    />
  )
}

function PortableWorkflow({ toolBlock, resultBlock, isStreaming }: ClaudeWorkflowPresenterProps) {
  const [expanded, setExpanded] = useState(false)
  const params = parseRecord(toolBlock.input)
  const result = resultBlock?.type === 'tool_result' ? resultBlock : undefined
  const phases = Array.isArray(toolBlock.workflowPhases)
    ? toolBlock.workflowPhases.map((phase) => ({ ...phase }))
    : Array.isArray(params.phases)
      ? params.phases.flatMap((phase) => {
          if (typeof phase === 'string') return [{ title: phase }]
          if (!phase || typeof phase !== 'object' || Array.isArray(phase)) return []
          const row = phase as Record<string, unknown>
          return [{ title: String(row.title ?? row.name ?? ''), detail: String(row.detail ?? '') || undefined }]
        }).filter((phase) => phase.title)
      : []
  const agents = (toolBlock.workflowAgents ?? []).map((agent, index) => ({
    agentId: agent.agentId ?? `agent-${index}`,
    label: agent.label,
    toolCount: agent.toolCount,
    tokens: agent.tokens,
    state: agent.state,
  }))
  const complete = Boolean(resultBlock || toolBlock.taskResultText)
  return (
    <WorkflowBlockPresenter
      colors={PORTABLE_COLORS}
      name={String(params.name ?? toolBlock.workflowName ?? '') || undefined}
      description={String(params.description ?? toolBlock.workflowDescription ?? '') || undefined}
      isSpawning={!complete && isStreaming && !params.name}
      isRunning={!complete && isStreaming}
      isComplete={complete}
      terminalStatus={result?.isError ? 'failed' : complete ? 'completed' : undefined}
      activePhase={toolBlock.workflowCurrentPhase}
      phases={phases}
      agents={agents}
      totalTokens={agents.reduce((sum, agent) => sum + (agent.tokens ?? 0), 0)}
      elapsed={toolBlock.elapsedSeconds ?? 0}
      expanded={expanded}
      onExpandedChange={setExpanded}
      canOpenFullView={false}
      onOpenFullView={() => undefined}
      logs={[]}
      resultText={result?.summary ?? toolBlock.taskResultText}
      runningSummary={toolBlock.taskSummary}
      formatTokens={formatTokens}
      StructuredOutput={({ data }) => <PlainCode>{data}</PlainCode>}
    />
  )
}

const GROUP_PORTS: GroupContentPorts = {
  isSubagentToolName,
  isWorkflowSmokeCheck,
  isHiddenToolBlock: (toolName) => isAlwaysHiddenToolName(toolName),
  resolveAppTool: () => null,
}

const CLAUDE_PARTS: ClaudeTurnBodyPresenterParts = {
  Text: PortableText,
  Document: PortableDocument,
  Tool: PortableClaudeTool,
  Reasoning: ReasoningBlock,
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
  isHiddenTool: (toolName) => isAlwaysHiddenToolName(toolName),
  summarizeProcess: summarizeClaudeProcess,
}

export function PortableClaudeTurn({ message }: { message: ChatMessage }) {
  const portableContent = useMemo(() => message.content.map((block): ContentBlock => (
    'toolName' in block && block.type !== 'tool_use'
      ? { ...block, type: 'tool_use' }
      : block
  )), [message.content])
  const grouped = useMemo(() => groupContentPresenter(portableContent, GROUP_PORTS), [portableContent])
  return (
    <ClaudeTurnBodyPresenter
      grouped={grouped}
      isStreaming={message.status === 'streaming'}
      detailChatMode={false}
      projectPath={null}
      parts={CLAUDE_PARTS}
      runtime={CLAUDE_RUNTIME}
    />
  )
}

function PortableCodexMarkdown({ text, isStreaming }: { text: string; isStreaming: boolean }) {
  return <PortableText text={text} isStreaming={isStreaming} />
}

function PortablePlanActions({
  onApprove,
  onReject,
}: {
  onApprove: () => void
  onReject: (feedback?: string) => void
}) {
  const [feedback, setFeedback] = useState('')
  return (
    <div className="flex w-full flex-col gap-2">
      <input
        aria-label="Plan feedback"
        className="h-8 w-full rounded bg-muted px-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        placeholder="Reject feedback (optional)"
        value={feedback}
        onChange={(event) => setFeedback(event.target.value)}
      />
      <div className="flex gap-2">
        <button
          className="flex h-8 flex-1 items-center justify-center gap-1 rounded bg-success px-3 text-xs font-medium text-success-foreground"
          type="button"
          onClick={onApprove}
        >
          <Check className="size-3.5" />
          Approve
        </button>
        <button
          className="flex h-8 flex-1 items-center justify-center gap-1 rounded bg-destructive px-3 text-xs font-medium text-destructive-foreground"
          type="button"
          onClick={() => onReject(feedback.trim() || undefined)}
        >
          <X className="size-3.5" />
          Reject
        </button>
      </div>
    </div>
  )
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

function PortableCodexItem(props: CodexItemPresenterProps) {
  const { item, index, isStreaming } = props
  switch (item.type) {
    case 'agent_message':
      return <div className="my-0.5"><PortableCodexMarkdown text={item.text} isStreaming={isStreaming} /></div>
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
        <div className="space-y-0.5">
          {(item.changes.length ? item.changes : [{ path: '', kind: 'update' as const }]).map((change, changeIndex) => (
            <PortableTool
              key={`${item.id}-${changeIndex}`}
              toolName="FileChange"
              toolUseId={`${item.id}-${changeIndex}`}
              input={stringify({ file_path: change.path, kind: change.kind, diff: change.diff ?? '' })}
              filePath={change.path}
              status="complete"
              result={item.status === 'failed' && changeIndex === 0 ? 'Failed to apply file changes.' : undefined}
              isError={item.status === 'failed'}
            />
          ))}
        </div>
      )
    case 'mcp_tool_call': {
      const fullToolName = `mcp__${item.server}__${item.tool}`
      const browserOp = portableBrowserOp(fullToolName, item.arguments)
      const computerOp = portableComputerOp(fullToolName)
      const deviceOp = portableDeviceOp(fullToolName)
      if (browserOp) {
        return (
          <PortableBrowserTool
            op={browserOp}
            input={item.arguments}
            result={codexMcpItemResultText(item)}
            isStreaming={item.status === 'in_progress'}
            isError={item.status === 'failed' || Boolean(item.error)}
          />
        )
      }
      if (computerOp) {
        return (
          <PortableComputerTool
            op={computerOp}
            input={item.arguments}
            result={codexMcpItemResultText(item)}
            isStreaming={item.status === 'in_progress'}
            isError={item.status === 'failed' || Boolean(item.error)}
          />
        )
      }
      if (deviceOp) {
        return (
          <PortableDeviceTool
            op={deviceOp}
            input={item.arguments}
            result={codexMcpItemResultText(item)}
            isStreaming={item.status === 'in_progress'}
            isError={item.status === 'failed' || Boolean(item.error)}
          />
        )
      }
      if (isImageGenerationTool(fullToolName)) {
        return (
          <PortableImageGenTool
            input={stringify(item.arguments)}
            result={codexMcpItemResultText(item)}
            isStreaming={item.status === 'in_progress'}
            isError={item.status === 'failed' || Boolean(item.error)}
          />
        )
      }
      if (isVideoGenerationTool(fullToolName)) {
        return (
          <PortableVideoGenTool
            input={stringify(item.arguments)}
            result={codexMcpItemResultText(item)}
            isStreaming={item.status === 'in_progress'}
            isError={item.status === 'failed' || Boolean(item.error)}
          />
        )
      }
      return (
        <PortableTool
          toolName={fullToolName}
          toolUseId={item.id}
          input={stringify(item.arguments)}
          result={codexMcpItemResultText(item)}
          status={item.status === 'in_progress' ? 'streaming' : 'complete'}
          isError={item.status === 'failed' || Boolean(item.error)}
        />
      )
    }
    case 'web_search':
      return (
        <PortableTool
          toolName="WebSearch"
          toolUseId={item.id}
          input={stringify({ query: item.query })}
          summary={item.query}
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
        <PortableTool
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

function PortableCodexCommand({ item, isStreaming }: CodexCommandPresenterProps) {
  const action = item.commandActions?.[0]
  const toolName = action?.type === 'read' ? 'Read' : action?.type === 'search' ? 'Grep' : 'Bash'
  const input = toolName === 'Read'
    ? { file_path: action?.path ?? item.command }
    : toolName === 'Grep'
      ? { pattern: action?.query ?? '', path: action?.path }
      : { command: item.command }
  return (
    <PortableTool
      toolName={toolName}
      toolUseId={item.id}
      input={stringify(input)}
      summary={action?.path ?? action?.query ?? item.command}
      filePath={action?.path}
      result={`${item.aggregatedOutput}${item.exitCode !== undefined ? `\n\nExit code ${item.exitCode}` : ''}`.trim() || undefined}
      status={isStreaming && item.status === 'in_progress' ? 'streaming' : 'complete'}
      isError={item.status === 'failed' || (item.exitCode != null && item.exitCode !== 0)}
    />
  )
}

function PortableCodexSubagent({ item }: CodexSubagentPresenterProps) {
  const [expanded, setExpanded] = useState(false)
  const view = codexCollabViewModel(item)
  const childContent = view.activityItems.length > 0 ? (
    <div className="space-y-0.5 border-t border-border/30 px-2 py-1">
      {view.activityItems.map((child, index) => {
        if (child.type === 'command_execution') {
          return <PortableCodexCommand key={`${child.id}-${index}`} item={child} isStreaming={view.isRunning} />
        }
        if (child.type === 'file_change') {
          return (
            <PortableTool
              key={`${child.id}-${index}`}
              toolName="FileChange"
              toolUseId={child.id}
              input={stringify({ changes: child.changes })}
              summary={child.changes[0]?.path}
              status="complete"
              isError={child.status === 'failed'}
              grouped
            />
          )
        }
        if (child.type === 'mcp_tool_call') {
          return (
            <PortableTool
              key={`${child.id}-${index}`}
              toolName={`mcp__${child.server}__${child.tool}`}
              toolUseId={child.id}
              input={stringify(child.arguments)}
              result={codexMcpItemResultText(child)}
              status={child.status === 'in_progress' ? 'streaming' : 'complete'}
              isError={child.status === 'failed' || Boolean(child.error)}
              grouped
            />
          )
        }
        if (child.type !== 'web_search') return null
        return (
          <PortableTool
            key={`${child.id}-${index}`}
            toolName="WebSearch"
            toolUseId={child.id}
            input={stringify({ query: child.query })}
            summary={child.query}
            status={child.status === 'in_progress' ? 'streaming' : 'complete'}
            isError={child.status === 'failed'}
            grouped
          />
        )
      })}
    </div>
  ) : undefined
  return (
    <CodexCollabBlockPresenter
      item={item}
      colors={PORTABLE_COLORS}
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

function PortableImageGallery({ items }: { items: ImageGenerationItem[] }) {
  const available = items.filter((item) => Boolean(item.savedPath))
  const unavailable = items.filter((item) => !item.savedPath)
  return (
    <>
      {available.length > 0 ? (
        <PortableNativeGallery
          payload={{
            kind: 'native',
            nativeType: 'image-gallery',
            title: available.some((item) => item.status === 'in_progress')
              ? 'Generating images…'
              : 'Generated images',
            images: available,
          }}
        />
      ) : null}
      {unavailable.length > 0 ? (
        <div className="my-2 grid grid-cols-2 gap-2" data-portable-image-placeholders>
          {unavailable.map((item) => (
            <button
              type="button"
              key={item.id}
              className="min-h-20 rounded-lg border border-border/60 bg-muted/25 p-2 text-left text-xs"
              disabled
            >
              <ImageIcon className="mb-2 size-5 text-muted-foreground" />
              <span className="block truncate font-medium">Generated image</span>
              <span className="block truncate text-muted-foreground">{item.revisedPrompt ?? item.status}</span>
            </button>
          ))}
        </div>
      ) : null}
    </>
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
  Reasoning: ReasoningBlock,
  Tool: PortableTool,
  ImageGallery: PortableImageGallery,
  TurnDetail: TurnDetailSection,
  AppIcon: PortableAppIcon,
}

const CODEX_RUNTIME: CodexTurnViewPresenterRuntime = {
  isHiddenMcpItem(item) {
    return item.type === 'mcp_tool_call'
      && isAlwaysHiddenToolName(`mcp__${item.server}__${item.tool}`)
  },
  isSpawnReady: (item: CodexCollabToolCallItem) => item.receiverThreadIds.length > 0,
  isSubagentFollowUp: (item: CodexCollabToolCallItem) => item.tool === 'sendInput' && item.receiverThreadIds.length > 0,
  isPinnedSegment: (segment, itemAt) => isCodexPinnedSegment(segment, itemAt, { isWidgetShowTool }),
  summarizeProcess: summarizeCodexProcess,
}

export function PortableCodexTurn({
  message,
  isLastAssistant,
}: {
  message: ChatMessage
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
    <CodexTurnViewPresenter
      message={message}
      isStreaming={message.status === 'streaming'}
      isWorking={message.status === 'streaming'}
      isLastAssistant={isLastAssistant}
      detailChatMode={false}
      canRespondToPlan
      onApprovePlan={() => respondToPlan('approved')}
      onRejectPlan={(feedback) => respondToPlan('rejected', feedback)}
      groupableAppByTool={EMPTY_MAP}
      appNameById={EMPTY_MAP}
      parts={CODEX_PARTS}
      runtime={CODEX_RUNTIME}
    />
  )
}

export function PortableTurnProvider({
  scheme,
  pendingPermission,
  children,
}: PortableTurnContextValue & { children: ReactNode }) {
  const value = useMemo(() => ({ scheme, pendingPermission }), [scheme, pendingPermission])
  return <PortableTurnContext.Provider value={value}>{children}</PortableTurnContext.Provider>
}
