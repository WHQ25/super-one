import { useDeferredToolDetail } from '@superone/chat-view/use-deferred-tool-detail'
import { useEffect, useMemo, useState } from 'react'
import type { ContentBlock } from '@superone/shared/agent-types'
import { useActiveSession, useChatStore } from '@/stores/chat'
import { formatTokens } from './chat-shared'
import { getSubagentColorClasses } from './subagent-colors'
import { SubagentRetryBadge } from './SubagentRetryBadge'
import {
  extractWorkflowScript,
  extractWorkflowScriptPath,
  mergeWorkflowPhaseRows,
  parseWorkflowInput,
  parseWorkflowLaunch,
  parseWorkflowScript,
  resolveGrokWorkflowDir,
  stripWorkflowNamePrefix,
  workflowArtifactPath,
  workflowToolTargetLabel,
  type WorkflowSubworkflowInfo,
} from './workflow-utils'
import { mergeLiveWorkflowAgents, useWorkflowAgents } from './use-workflow-agents'
import { useWorkflowModel, useWorkflowScriptSource } from './use-workflow-model'
import { deriveWorkflowName, type ReplayResult } from './workflow-replay'
import type { ChildWorkflowScript } from './use-workflow-graph'
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

const AGENT_REFRESH_MS = 3000

/** Child workflows the replay entered, with the parent phase each was called from. */
function subworkflowViews(
  replay: ReplayResult | null,
  childScripts: ChildWorkflowScript[],
): WorkflowSubworkflowInfo[] {
  if (!replay) return []
  return [...replay.subworkflowHosts].map(([name, hostPhase]) => {
    const child = childScripts.find((cs) => (cs.name ?? deriveWorkflowName(cs.scriptPath)) === name)
    const childMeta = child ? parseWorkflowScript(child.source) : undefined
    return { name, hostPhase, description: childMeta?.description || undefined, phases: childMeta?.phases ?? [] }
  })
}

function DesktopStructuredOutput({ data, fill }: WorkflowStructuredOutputProps) {
  return <StructuredOutputView data={data} fill={fill} />
}

/** Desktop session/filesystem adapter for the portable workflow presenter. */
export function WorkflowBlock({
  toolBlock: shellToolBlock,
  resultBlock: shellResultBlock,
  isStreaming,
  defaultExpanded,
}: WorkflowBlockProps) {
  const [expanded, setExpanded] = useState(defaultExpanded ?? false)
  // A summarized card (`remoteDetail`) loads its script and result when it opens.
  const remoteDetail = shellToolBlock.remoteDetail
  const { detail } = useDeferredToolDetail(remoteDetail, expanded, !isStreaming && !!shellResultBlock)
  const toolBlock = useMemo(() => remoteDetail
    ? { ...shellToolBlock, ...(detail.input ? { input: detail.input } : {}), taskResultText: detail.taskResultText ?? shellToolBlock.taskResultText }
    : shellToolBlock, [remoteDetail, shellToolBlock, detail])
  const resultBlock = remoteDetail && shellResultBlock?.type === 'tool_result' && detail.result !== undefined
    ? { ...shellResultBlock, summary: detail.result }
    : shellResultBlock
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
  const { source: scriptSource } = useWorkflowScriptSource({
    script,
    scriptPath,
    transcriptDir,
    enabled: expanded,
  })
  const inputHasPhaseDetails = meta.phases.some((phase) => !!phase.detail)
  const diskMeta = useMemo(() => {
    if (inputHasPhaseDetails || !scriptSource) return null
    const parsed = parseWorkflowScript(scriptSource)
    return parsed.phases.some((phase) => !!phase.detail) ? parsed : null
  }, [inputHasPhaseDetails, scriptSource])
  const hasTranscript = !!transcriptDir
  const hasLaunchIdentity = hasTranscript || !!runKey || !!progress?.taskId
  const launched = hasLaunchIdentity || !!progress
  // A denied or blocked call is ToolCallStatus::Failed ("was not executed") and
  // never receives a run id. That is a start failure, not a finished run.
  const launchError = resultBlock?.type === 'tool_result' && resultBlock.isError === true
    ? resultBlock.summary
    : undefined
  const launchFailed = !!launchError && !hasLaunchIdentity && !progress
  const isComplete = launchFailed || (progress
    ? progress.completed === true
    : !!launch.transcriptDir || !!toolBlock.taskResultText || (!!runKey && !isStreaming))
  const isRunning = launchFailed ? false : (launched ? !isComplete : isStreaming)
  const name = meta.name
    || toolBlock.workflowName
    || launch.name
    || workflowToolTargetLabel(toolBlock.input)
    || undefined
  const isSpawning = !launchFailed && !launched && !isComplete && !name
  const terminalStatus = launchFailed ? 'failed' as const : progress?.status
  // While the run is open and visible, re-list on progress, at most every few seconds.
  const refreshKey = isComplete || !expanded ? isComplete : Math.floor((progress?.durationMs ?? 0) / AGENT_REFRESH_MS)
  const transcriptAgents = useWorkflowAgents(transcriptDir, hasTranscript, refreshKey)
  const liveRows = progress?.workflowAgents ?? toolBlock.workflowAgents
  const agents = useMemo(() => mergeLiveWorkflowAgents(transcriptAgents, liveRows), [liveRows, transcriptAgents])
  const model = useWorkflowModel(expanded ? scriptSource : undefined, agents)
  const subworkflows = useMemo(
    () => subworkflowViews(model.replay, model.childScripts),
    [model.replay, model.childScripts],
  )
  const agentSubworkflow = useMemo(() => {
    const byAgent = new Map<string, string>()
    for (const node of model.dag?.nodes ?? []) {
      const agentId = node.subworkflow ? model.nodeToAgent.get(node.id) : undefined
      if (agentId && node.subworkflow) byAgent.set(agentId, node.subworkflow)
    }
    return byAgent
  }, [model.dag, model.nodeToAgent])
  const canOpenFullView = hasTranscript || !!script || !!scriptPath
  const outputFile = progress?.outputFile
    ?? (resultBlock?.type === 'tool_result' ? resultBlock.outputPath : undefined)
  const output = useWorkflowOutput(outputFile, expanded && hasTranscript)
  const resultText = useMemo(() => {
    if (launchFailed && launchError) return launchError
    if (progress?.resultText) return progress.resultText
    if (typeof toolBlock.taskResultText === 'string' && toolBlock.taskResultText) {
      return toolBlock.taskResultText
    }
    if (!output || output.result === undefined) return undefined
    return typeof output.result === 'string' ? output.result : JSON.stringify(output.result, null, 2)
  }, [launchError, launchFailed, output, progress?.resultText, toolBlock.taskResultText])
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
  const phases = useMemo(
    () => mergeWorkflowPhaseRows(livePhases, diskMeta?.phases, meta.phases, toolBlock.workflowPhases),
    [diskMeta?.phases, livePhases, meta.phases, toolBlock.workflowPhases],
  )
  const description = stripWorkflowNamePrefix(
    meta.description || toolBlock.workflowDescription || progress?.description || undefined,
    name,
  )
  const openFullView = (agentId?: string) => nav.open({
    toolUseId: toolBlock.toolUseId,
    transcriptDir,
    name: name ?? '',
    script,
    scriptPath: script ? undefined : scriptPath,
    agentId,
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
        phase: agent.phase,
        subworkflow: agentSubworkflow.get(agent.agentId),
      }))}
      subworkflows={subworkflows}
      totalTokens={progress?.totalTokens || agentsTokens}
      elapsed={progress?.durationMs ? Math.round(progress.durationMs / 1000) : 0}
      expanded={expanded}
      onExpandedChange={setExpanded}
      canOpenFullView={canOpenFullView}
      onOpenFullView={() => openFullView()}
      onOpenAgent={openFullView}
      retryBadge={isRunning && progress?.retry
        ? <SubagentRetryBadge retry={progress.retry} className="ml-1" />
        : undefined}
      logs={output?.logs ?? []}
      resultText={resultText}
      terminalSummary={launchFailed
        ? launchError
        : stripWorkflowNamePrefix(progress?.summary, name)}
      formatTokens={formatTokens}
      StructuredOutput={DesktopStructuredOutput}
    />
  )
}

export {
  WorkflowBlockPresenter,
  type WorkflowBlockPresenterProps,
} from './presenters/WorkflowBlock'
