import { useEffect, useMemo, useState } from 'react'
import type { ContentBlock } from '@superone/shared/agent-types'
import { useActiveSession, useChatStore } from '@/stores/chat'
import { formatTokens } from './chat-shared'
import { getSubagentColorClasses } from './subagent-colors'
import { SubagentRetryBadge } from './SubagentRetryBadge'
import {
  extractWorkflowScript,
  extractWorkflowScriptPath,
  parseWorkflowInput,
  parseWorkflowLaunch,
  resolveGrokWorkflowDir,
  stripWorkflowNamePrefix,
  workflowArtifactPath,
} from './workflow-utils'
import { useWorkflowAgents, type WorkflowAgentInfo } from './use-workflow-agents'
import { useWorkflowOutput } from './use-workflow-output'
import { useWorkflowNavigation } from './workflow-navigation-context'
import { StructuredOutputView } from './StructuredOutputView'
import {
  WorkflowBlockPresenter,
  type WorkflowStructuredOutputProps,
} from './presenters/WorkflowBlock'

export interface WorkflowBlockProps {
  toolBlock: ContentBlock & { type: 'tool_use' }
  resultBlock?: ContentBlock
  isStreaming: boolean
  defaultExpanded?: boolean
}

function phaseFromSummary(summary?: string): string | undefined {
  if (!summary) return undefined
  const match = summary.match(/(?:^|·\s*)phase:\s*([^·]+)/i)
  return match?.[1]?.trim() || undefined
}

function DesktopStructuredOutput({ data, fill }: WorkflowStructuredOutputProps) {
  return <StructuredOutputView data={data} fill={fill} />
}

/** Desktop session/filesystem adapter for the portable workflow presenter. */
export function WorkflowBlock({
  toolBlock,
  resultBlock,
  isStreaming,
  defaultExpanded,
}: WorkflowBlockProps) {
  const [expanded, setExpanded] = useState(defaultExpanded ?? false)
  const launch = useMemo(
    () => parseWorkflowLaunch(resultBlock?.type === 'tool_result' ? resultBlock.summary : undefined),
    [resultBlock],
  )
  const runKey = launch.runId ?? launch.taskId
  const progress = useActiveSession((state) => {
    const byTool = state.taskProgress[toolBlock.toolUseId]
    if (byTool) return byTool
    if (!runKey) return undefined
    if (state.taskProgress[runKey]) return state.taskProgress[runKey]
    return Object.values(state.taskProgress).find((entry) => entry.taskId === runKey)
  })
  const colorIndex = useActiveSession((state) => state.subagentColors[toolBlock.toolUseId])
  const cwd = useActiveSession((state) => state.cwd)
  const providerSessionId = useActiveSession((state) => state._providerSessionId)
  const homedir = useChatStore((state) => {
    const activeProject = state.activeProject
    return activeProject ? state.projectSessions[activeProject]?.homedir || '' : ''
  })
  const colors = useMemo(() => getSubagentColorClasses(colorIndex), [colorIndex])
  const meta = useMemo(() => parseWorkflowInput(toolBlock.input), [toolBlock.input])
  const script = useMemo(() => extractWorkflowScript(toolBlock.input), [toolBlock.input])
  const inputScriptPath = useMemo(
    () => extractWorkflowScriptPath(toolBlock.input),
    [toolBlock.input],
  )
  const nav = useWorkflowNavigation()

  useEffect(() => {
    useChatStore.getState().assignSubagentColor(toolBlock.toolUseId)
  }, [toolBlock.toolUseId])

  const transcriptDir = useMemo(() => {
    if (launch.transcriptDir) return launch.transcriptDir
    return resolveGrokWorkflowDir({
      runId: launch.runId ?? runKey,
      cwd,
      providerSessionId,
      homedir,
    })
  }, [cwd, homedir, launch.runId, launch.transcriptDir, providerSessionId, runKey])
  const scriptPath = launch.scriptPath
    ?? inputScriptPath
    ?? workflowArtifactPath(transcriptDir, 'script.rhai')
  const hasTranscript = !!transcriptDir
  const hasLaunchIdentity = hasTranscript || !!runKey || !!progress?.taskId
  const launched = hasLaunchIdentity || !!progress
  const isComplete = progress
    ? progress.completed === true
    : !!launch.transcriptDir || !!toolBlock.taskResultText || (!!runKey && !isStreaming)
  const isRunning = launched ? !isComplete : isStreaming
  const isSpawning = !launched && !isComplete && !meta.name
  const terminalStatus = progress?.status
  const transcriptAgents = useWorkflowAgents(transcriptDir, hasTranscript, isComplete)
  const liveAgents: WorkflowAgentInfo[] = useMemo(() => {
    const rows = progress?.workflowAgents ?? toolBlock.workflowAgents
    if (!rows?.length) return []
    return rows.map((agent, index) => ({
      agentId: agent.agentId ?? `live-${agent.label}-${index}`,
      jsonlPath: '',
      label: agent.label,
      toolCount: agent.toolCount,
      tokens: agent.tokens,
      phase: agent.phase,
      state: agent.state,
    }))
  }, [progress?.workflowAgents, toolBlock.workflowAgents])
  const agents = useMemo(() => {
    const base = transcriptAgents.length > 0 ? transcriptAgents : liveAgents
    const liveRows = progress?.workflowAgents ?? toolBlock.workflowAgents
    if (!liveRows?.length) return base
    return base.map((agent) => {
      const live = liveRows.find(
        (row) => (row.agentId && row.agentId === agent.agentId) || row.label === agent.label,
      )
      return live ? {
        ...agent,
        phase: agent.phase ?? live.phase,
        state: live.state ?? agent.state,
        tokens: agent.tokens ?? live.tokens,
        toolCount: agent.toolCount || live.toolCount,
      } : agent
    })
  }, [liveAgents, progress?.workflowAgents, toolBlock.workflowAgents, transcriptAgents])
  const canOpenFullView = hasTranscript || !!script || !!scriptPath
  const outputFile = progress?.outputFile
    ?? (resultBlock?.type === 'tool_result' ? resultBlock.outputPath : undefined)
  const output = useWorkflowOutput(outputFile, expanded && hasTranscript)
  const resultText = useMemo(() => {
    if (progress?.resultText) return progress.resultText
    if (typeof toolBlock.taskResultText === 'string' && toolBlock.taskResultText) {
      return toolBlock.taskResultText
    }
    if (!output || output.result === undefined) return undefined
    return typeof output.result === 'string' ? output.result : JSON.stringify(output.result, null, 2)
  }, [output, progress?.resultText, toolBlock.taskResultText])
  const agentsTokens = useMemo(
    () => agents.reduce((sum, agent) => sum + (agent.tokens ?? 0), 0),
    [agents],
  )
  const activePhase = isRunning
    ? progress?.currentPhase
      ?? toolBlock.workflowCurrentPhase
      ?? phaseFromSummary(progress?.summary ?? toolBlock.taskSummary)
    : undefined
  const livePhases = progress?.workflowPhases ?? toolBlock.workflowPhases
  const phases = useMemo(() => {
    const detailByTitle = new Map(meta.phases.map((phase) => [phase.title, phase.detail] as const))
    if (livePhases?.length) {
      return livePhases.map((phase) => ({
        title: phase.title,
        detail: phase.detail ?? detailByTitle.get(phase.title),
        state: phase.state,
      }))
    }
    return meta.phases.map((phase) => ({
      title: phase.title,
      detail: phase.detail,
      state: undefined,
    }))
  }, [livePhases, meta.phases])
  const name = meta.name || toolBlock.workflowName || launch.name || undefined
  const description = stripWorkflowNamePrefix(
    meta.description || toolBlock.workflowDescription || progress?.description || undefined,
    name,
  )
  const openFullView = () => nav.open({
    toolUseId: toolBlock.toolUseId,
    transcriptDir,
    name: name ?? '',
    script,
    scriptPath: script ? undefined : scriptPath,
  })

  return (
    <WorkflowBlockPresenter
      colors={colors}
      name={name}
      description={description}
      isSpawning={isSpawning}
      isRunning={isRunning}
      isComplete={isComplete}
      terminalStatus={terminalStatus}
      activePhase={activePhase}
      phases={phases}
      agents={agents.map((agent) => ({
        agentId: agent.agentId,
        label: agent.label,
        toolCount: agent.toolCount,
        tokens: agent.tokens,
        state: agent.state,
      }))}
      totalTokens={progress?.totalTokens || agentsTokens}
      elapsed={progress?.durationMs ? Math.round(progress.durationMs / 1000) : 0}
      expanded={expanded}
      onExpandedChange={setExpanded}
      canOpenFullView={canOpenFullView}
      onOpenFullView={openFullView}
      retryBadge={isRunning && progress?.retry
        ? <SubagentRetryBadge retry={progress.retry} className="ml-1" />
        : undefined}
      logs={output?.logs ?? []}
      resultText={resultText}
      runningSummary={stripWorkflowNamePrefix(
        progress?.summary || progress?.description || toolBlock.taskSummary,
        name,
      )}
      terminalSummary={stripWorkflowNamePrefix(progress?.summary, name)}
      formatTokens={formatTokens}
      StructuredOutput={DesktopStructuredOutput}
    />
  )
}

export {
  WorkflowBlockPresenter,
  type WorkflowBlockPresenterProps,
} from './presenters/WorkflowBlock'
