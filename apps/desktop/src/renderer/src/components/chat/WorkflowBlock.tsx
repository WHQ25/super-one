import { useDeferredToolDetail } from '@superone/chat-view/use-deferred-tool-detail'
import { useEffect, useMemo, useState } from 'react'
import type { ContentBlock } from '@superone/shared/agent-types'
import { useActiveSession, useChatStore } from '@/stores/chat'
import { formatTokens } from './chat-shared'
import { getSubagentColorClasses } from './subagent-colors'
import { SubagentRetryBadge } from './SubagentRetryBadge'
import {
  mergeWorkflowPhaseRows,
  normalizeWorkflowRun,
  parseWorkflowScript,
  resolveWorkflowAdapter,
  stripWorkflowNamePrefix,
  type WorkflowSubworkflowInfo,
} from './workflow-utils'
import { mergeLiveWorkflowAgents, useWorkflowAgents } from './use-workflow-agents'
import { useWorkflowAgentTranscripts } from './use-workflow-agent-transcripts'
import { useWorkflowLog } from './use-workflow-log'
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

export function WorkflowBlock({
  toolBlock: shellToolBlock,
  resultBlock: shellResultBlock,
  isStreaming,
  defaultExpanded,
}: WorkflowBlockProps) {
  const [expanded, setExpanded] = useState(defaultExpanded ?? false)
  const [logPollTick, setLogPollTick] = useState(0)
  const remoteDetail = shellToolBlock.remoteDetail
  const { detail } = useDeferredToolDetail(remoteDetail, expanded, !isStreaming && !!shellResultBlock)
  const toolBlock = useMemo(() => remoteDetail
    ? { ...shellToolBlock, ...(detail.input ? { input: detail.input } : {}), taskResultText: detail.taskResultText ?? shellToolBlock.taskResultText }
    : shellToolBlock, [remoteDetail, shellToolBlock, detail])
  const resultBlock = remoteDetail && shellResultBlock?.type === 'tool_result' && detail.result !== undefined
    ? { ...shellResultBlock, summary: detail.result }
    : shellResultBlock
  const resultSummary = resultBlock?.type === 'tool_result' ? resultBlock.summary : undefined
  const adapter = useMemo(
    () => resolveWorkflowAdapter(toolBlock.input, resultSummary),
    [toolBlock.input, resultSummary],
  )
  const parsedInput = useMemo(() => adapter.parseInput(toolBlock.input), [adapter, toolBlock.input])
  const launch = useMemo(() => adapter.parseLaunch(resultSummary), [adapter, resultSummary])
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
  const nav = useWorkflowNavigation()

  useEffect(() => {
    useChatStore.getState().assignSubagentColor(toolBlock.toolUseId)
  }, [toolBlock.toolUseId])

  const baseNormalized = useMemo(() => normalizeWorkflowRun({
    input: toolBlock.input,
    summary: resultSummary,
    harnessHint: adapter.id,
    runContext: { cwd, providerSessionId, homedir },
    fallbackName: toolBlock.workflowName,
    fallbackDescription: toolBlock.workflowDescription || progress?.description,
  }), [
    adapter.id,
    cwd,
    homedir,
    progress?.description,
    providerSessionId,
    resultSummary,
    toolBlock.input,
    toolBlock.workflowDescription,
    toolBlock.workflowName,
  ])

  const transcriptDir = baseNormalized.transcriptDir
  const logPath = baseNormalized.logPath
  const scriptPath = baseNormalized.scriptPath
  const { source: scriptSource, path: loadedScriptPath } = useWorkflowScriptSource({
    script: parsedInput.script,
    scriptPath,
    transcriptDir,
    scriptCandidates: baseNormalized.scriptCandidates,
    enabled: expanded,
  })
  const inputHasPhaseDetails = parsedInput.phases.some((phase) => !!phase.detail)
  const diskMeta = useMemo(() => {
    if (inputHasPhaseDetails || !scriptSource) return null
    const parsed = parseWorkflowScript(scriptSource)
    return parsed.phases.some((phase) => !!phase.detail) ? parsed : null
  }, [inputHasPhaseDetails, scriptSource])
  const hasTranscript = baseNormalized.hasTranscript
  const hasLogSource = baseNormalized.hasLogSource
  const hasLaunchIdentity = hasTranscript || hasLogSource || !!runKey || !!progress?.taskId
  const launched = hasLaunchIdentity || !!progress
  const launchError = resultBlock?.type === 'tool_result' && resultBlock.isError === true
    ? resultBlock.summary
    : undefined
  const launchFailed = !!launchError && !hasLaunchIdentity && !progress
  const isBackgroundLaunchAck = Boolean(launch.isBackgroundLaunchAck)
  const blockCompleted = Boolean(toolBlock.taskStatus || toolBlock.taskResultText)
  const logRefreshKey = `${String(progress?.completed === true || blockCompleted)}:${Math.floor((progress?.durationMs ?? 0) / AGENT_REFRESH_MS)}:${logPollTick}`
  const rawLogText = useWorkflowLog(logPath, hasLogSource, logRefreshKey)
  const parsedLog = useMemo(() => {
    if (rawLogText) return adapter.parseLogFile?.(rawLogText) ?? null
    return adapter.parseInlineResult?.(resultSummary) ?? null
  }, [adapter, rawLogText, resultSummary])
  const parsedLogCompleted = Boolean(parsedLog?.resultText)
  const isComplete = launchFailed || (progress
    ? progress.completed === true
    : isBackgroundLaunchAck
      ? blockCompleted || parsedLogCompleted
      : !!launch.transcriptDir || blockCompleted || ((!!runKey || resultBlock?.type === 'tool_result') && !isStreaming))
  const isRunning = launchFailed ? false : (launched ? !isComplete : isStreaming)
  const name = baseNormalized.name
  const isSpawning = !launchFailed && !launched && !isComplete && !name
  const terminalStatus = launchFailed ? 'failed' as const : (progress?.status ?? toolBlock.taskStatus)
  const refreshKey = isComplete || !expanded ? isComplete : Math.floor((progress?.durationMs ?? 0) / AGENT_REFRESH_MS)

  useEffect(() => {
    if (!isRunning || !expanded || !hasLogSource) return
    const timer = setInterval(() => {
      setLogPollTick((n) => n + 1)
    }, AGENT_REFRESH_MS)
    return () => clearInterval(timer)
  }, [expanded, hasLogSource, isRunning])

  const transcriptAgents = useWorkflowAgents(transcriptDir, hasTranscript, refreshKey)

  const liveRows = progress?.workflowAgents ?? toolBlock.workflowAgents
  const baseAgents = transcriptAgents.length > 0 ? transcriptAgents : (parsedLog?.agents ?? [])
  const enrichedBaseAgents = useWorkflowAgentTranscripts(
    baseAgents,
    logPath,
    !hasTranscript && baseAgents.length > 0,
    `${String(refreshKey)}:${logPollTick}`,
  )
  const agents = useMemo(() => mergeLiveWorkflowAgents(enrichedBaseAgents, liveRows), [enrichedBaseAgents, liveRows])

  const normalized = useMemo(() => normalizeWorkflowRun({
    input: toolBlock.input,
    summary: resultSummary,
    harnessHint: adapter.id,
    runContext: { cwd, providerSessionId, homedir },
    scriptSource,
    loadedScriptPath,
    rawLogText,
    livePhases: progress?.workflowPhases ?? toolBlock.workflowPhases,
    extraPhases: [diskMeta?.phases, parsedLog?.phases, toolBlock.workflowPhases],
    agents,
    fallbackName: toolBlock.workflowName,
    fallbackDescription: toolBlock.workflowDescription || progress?.description,
  }), [
    adapter.id,
    agents,
    cwd,
    diskMeta?.phases,
    homedir,
    loadedScriptPath,
    parsedLog?.phases,
    progress?.description,
    progress?.workflowPhases,
    providerSessionId,
    rawLogText,
    resultSummary,
    scriptSource,
    toolBlock.input,
    toolBlock.workflowDescription,
    toolBlock.workflowName,
    toolBlock.workflowPhases,
  ])

  const model = useWorkflowModel(expanded ? scriptSource : undefined, agents, {
    supportsJsReplay: normalized.supportsJsReplay,
    supportsStaticGraph: normalized.supportsStaticGraph,
  })
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
  const canOpenFullView = hasTranscript || hasLogSource || !!parsedInput.script || !!scriptPath || agents.length > 0
  const outputFile = progress?.outputFile
    ?? (resultBlock?.type === 'tool_result' ? resultBlock.outputPath : undefined)
  const output = useWorkflowOutput(outputFile, expanded && hasTranscript)
  const resultText = useMemo(() => {
    if (launchFailed && launchError) return launchError
    if (progress?.resultText) return progress.resultText
    if (typeof toolBlock.taskResultText === 'string' && toolBlock.taskResultText) {
      return toolBlock.taskResultText
    }
    if (output && output.result !== undefined) {
      return typeof output.result === 'string' ? output.result : JSON.stringify(output.result, null, 2)
    }
    return normalized.resultText
  }, [launchError, launchFailed, normalized.resultText, output, progress?.resultText, toolBlock.taskResultText])
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
    () => mergeWorkflowPhaseRows(livePhases, diskMeta?.phases, parsedInput.phases, parsedLog?.phases, toolBlock.workflowPhases),
    [diskMeta?.phases, livePhases, parsedInput.phases, parsedLog?.phases, toolBlock.workflowPhases],
  )
  const logs = output?.logs?.length ? output.logs : normalized.logs
  const openFullView = (agentId?: string) => nav.open({
    toolUseId: toolBlock.toolUseId,
    harness: normalized.harness,
    transcriptDir,
    logPath,
    inlineSummary: !logPath ? resultSummary : undefined,
    runKey,
    name: name ?? '',
    script: parsedInput.script,
    scriptPath: parsedInput.script ? undefined : scriptPath,
    scriptCandidates: normalized.scriptCandidates,
    agentId,
  })

  return (
    <WorkflowBlockPresenter
      colors={colors}
      name={name}
      description={normalized.description}
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
      logs={logs}
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
