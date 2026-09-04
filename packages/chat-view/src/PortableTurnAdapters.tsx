import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import type {
  ChatMessage,
  CodexCollabToolCallItem,
  CodexThreadItem,
  ContentBlock,
  ImageGenerationItem,
} from '@superone/shared/agent-types'
import { isAlwaysHiddenToolName, isSubagentToolName } from '@superone/shared/tool-ui'
import {
  Check,
  ClipboardList,
  FileText,
  ImageIcon,
  Puzzle,
  ScanSearch,
  TriangleAlert,
} from 'lucide-react'
import { requestNative } from './bridge'
import { PortableMarkdown, PlainCode } from './PortableMarkdown'
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
  return (
    <PortableTool
      {...props}
      summary={props.toolSummary}
      pendingPermission={isPermissionPending(pendingPermission, props.toolUseId, props.toolName)}
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

function PortablePlan({ item, isStreaming }: CodexItemPresenterProps) {
  const [expanded, setExpanded] = useState(isStreaming)
  if (item.type !== 'plan') return null
  return (
    <div className="my-1 overflow-hidden rounded border border-border/60 bg-muted/30 text-xs">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 px-2 py-2 text-left"
        onClick={() => setExpanded((value) => !value)}
      >
        <ClipboardList className="size-3.5 shrink-0 text-primary" />
        <span className="font-medium">Plan</span>
        {!expanded && <span className="min-w-0 truncate text-muted-foreground">{item.text.split('\n')[0]}</span>}
      </button>
      {expanded && <div className="border-t border-border/50 px-3 py-2"><PortableCodexMarkdown text={item.text} isStreaming={isStreaming} /></div>}
    </div>
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
    case 'mcp_tool_call':
      return (
        <PortableTool
          toolName={`mcp__${item.server}__${item.tool}`}
          toolUseId={item.id}
          input={stringify(item.arguments)}
          result={codexMcpItemResultText(item)}
          status={item.status === 'in_progress' ? 'streaming' : 'complete'}
          isError={item.status === 'failed' || Boolean(item.error)}
        />
      )
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

function latestAgentText(items: CodexThreadItem[]): string | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item.type === 'agent_message') return item.text
  }
  return undefined
}

function PortableCodexSubagent({ item }: CodexSubagentPresenterProps) {
  const [expanded, setExpanded] = useState(false)
  const receiverId = item.receiverThreadIds[0] ?? Object.keys(item.agentsStates)[0]
  const state = receiverId ? item.agentsStates[receiverId] : undefined
  const children = receiverId ? item.childItems?.[receiverId] ?? [] : []
  const failed = item.status === 'failed' || state?.status === 'errored'
  const complete = item.status === 'completed' || state?.status === 'completed'
  const stopped = state?.status === 'shutdown' || state?.status === 'notFound'
  return (
    <SubagentBlockPresenter
      toolUseId={item.id}
      taskInput={{
        name: state?.nickname ?? '',
        teamName: '',
        description: state?.role ?? '',
        subagentType: state?.role ?? 'agent',
        prompt: item.prompt ?? '',
      }}
      colors={PORTABLE_COLORS}
      isAsync={false}
      isRunning={!failed && !complete && !stopped}
      isComplete={failed || complete || stopped}
      isFailed={failed}
      isStopped={stopped}
      expanded={expanded}
      onExpandedChange={setExpanded}
      canOpenFullView={false}
      onOpenFullView={() => undefined}
      initialElapsed={0}
      stats={{
        toolCalls: children.filter((child) => ['command_execution', 'file_change', 'mcp_tool_call', 'web_search'].includes(child.type)).length,
        inputTokens: state?.tokens?.input,
        outputTokens: state?.tokens?.output,
      }}
      resultText={latestAgentText(children) ?? state?.message}
      diagnostic={failed ? state?.message : undefined}
      formatTokens={formatTokens}
      Markdown={({ text }) => <PortableText text={text} isStreaming={false} />}
    />
  )
}

function PortableImageGallery({ items }: { items: ImageGenerationItem[] }) {
  return (
    <div className="my-2 grid grid-cols-2 gap-2">
      {items.map((item) => {
        const path = item.previewPath ?? item.savedPath
        return (
          <button
            type="button"
            key={item.id}
            className="min-h-20 rounded-lg border border-border/60 bg-muted/25 p-2 text-left text-xs"
            onClick={() => path && requestNative('openFile', { path })}
            disabled={!path}
          >
            <ImageIcon className="mb-2 size-5 text-muted-foreground" />
            <span className="block truncate font-medium">{path?.split('/').pop() ?? 'Generated image'}</span>
            <span className="block truncate text-muted-foreground">{item.revisedPrompt ?? item.status}</span>
          </button>
        )
      })}
    </div>
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
  return (
    <CodexTurnViewPresenter
      message={message}
      isStreaming={message.status === 'streaming'}
      isWorking={message.status === 'streaming'}
      isLastAssistant={isLastAssistant}
      detailChatMode={false}
      canRespondToPlan={false}
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
