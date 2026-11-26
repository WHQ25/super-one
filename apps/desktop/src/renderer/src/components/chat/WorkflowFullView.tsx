import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Workflow, Network, Code, Bot, List, Wrench } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import { useWorkflowNavigation, type WorkflowViewState } from './workflow-navigation-context'
import { useActiveSession } from '@/stores/chat'
import { getSubagentColorClasses } from './subagent-colors'
import { HighlightedCodeBlock } from './CodeBlock'
import { mergeLiveWorkflowAgents, useWorkflowAgents, type WorkflowAgentInfo } from './use-workflow-agents'
import { useWorkflowAgentTranscripts } from './use-workflow-agent-transcripts'
import { useWorkflowLog } from './use-workflow-log'
import { resolveAgentPhase, type DagNode } from './workflow-dag'
import { useWorkflowModel, useWorkflowScriptSource } from './use-workflow-model'
import { WorkflowDagCanvas } from './WorkflowDagCanvas'
import {
  AgentTranscript,
  ScriptSection,
  TranscriptHeader,
  WorkflowOutputFooter,
} from './WorkflowFullViewParts'
import {
  detectWorkflowScriptLanguage,
  resolveWorkflowAdapter,
  workflowAgentIconClass,
} from './workflow-utils'
import { codePlugin, formatTokens } from './chat-shared'

export function WorkflowFullView({ view }: { view: WorkflowViewState }) {
  const { t } = useTranslation()
  const nav = useWorkflowNavigation()
  const adapter = useMemo(() => {
    const syntheticInput = view.script || view.scriptPath
      ? JSON.stringify({
        ...(view.script ? { script: view.script } : {}),
        ...(view.scriptPath ? { scriptPath: view.scriptPath } : {}),
      })
      : ''
    const syntheticSummary = view.inlineSummary
      ?? (view.logPath ? `Task logs are available at: file://${view.logPath}` : undefined)
      ?? (view.transcriptDir ? `Transcript dir: ${view.transcriptDir}` : undefined)
    return resolveWorkflowAdapter(syntheticInput, syntheticSummary, view.harness)
  }, [view.harness, view.inlineSummary, view.logPath, view.script, view.scriptPath, view.transcriptDir])

  const diskAgents = useWorkflowAgents(view.transcriptDir, Boolean(view.transcriptDir))
  const rawLogText = useWorkflowLog(view.logPath, Boolean(view.logPath))
  const parsedLog = useMemo(() => {
    if (rawLogText) return adapter.parseLogFile?.(rawLogText) ?? null
    return adapter.parseInlineResult?.(view.inlineSummary) ?? null
  }, [adapter, rawLogText, view.inlineSummary])
  const liveProgress = useActiveSession((s) => {
    const byTool = s.taskProgress[view.toolUseId]
    if (byTool?.workflowAgents?.length) return byTool
    if (view.runKey && s.taskProgress[view.runKey]?.workflowAgents?.length) {
      return s.taskProgress[view.runKey]
    }
    for (const entry of Object.values(s.taskProgress)) {
      if (!entry.workflowAgents?.length || !entry.taskId) continue
      if (entry.taskId === view.runKey || view.transcriptDir?.includes(entry.taskId)) {
        return entry
      }
    }
    return undefined
  })
  const liveRows = liveProgress?.workflowAgents
  const isRunning = !!liveProgress && !liveProgress.completed
  const baseAgents = diskAgents.length > 0 ? diskAgents : (parsedLog?.agents ?? [])
  const enrichedBaseAgents = useWorkflowAgentTranscripts(
    baseAgents,
    view.logPath,
    !view.transcriptDir && baseAgents.length > 0,
  )
  const agents = useMemo(() => mergeLiveWorkflowAgents(enrichedBaseAgents, liveRows), [enrichedBaseAgents, liveRows])
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const scriptCandidates = useMemo(
    () => view.scriptCandidates ?? adapter.resolveScriptCandidates({
      scriptPath: view.scriptPath,
      transcriptDir: view.transcriptDir,
    }),
    [adapter, view.scriptCandidates, view.scriptPath, view.transcriptDir],
  )
  const { source: script, path: loadedFromPath } = useWorkflowScriptSource({
    script: view.script,
    scriptPath: view.scriptPath,
    transcriptDir: view.transcriptDir,
    scriptCandidates,
  })
  const resolvedScriptLanguage = useMemo(
    () => detectWorkflowScriptLanguage(script, loadedFromPath ?? view.scriptPath, adapter.defaultLanguage),
    [adapter.defaultLanguage, loadedFromPath, script, view.scriptPath],
  )
  const { graph, childScripts, replay, dag, nodeToAgent } = useWorkflowModel(script, agents, {
    supportsJsReplay: adapter.supportsJsReplay && resolvedScriptLanguage === 'javascript',
    supportsStaticGraph: adapter.supportsStaticGraph,
  })
  const selected = useMemo(() => {
    const agentId = selectedNodeId ? nodeToAgent.get(selectedNodeId) : undefined
    return agentId ? agents.find((a) => a.agentId === agentId) : undefined
  }, [agents, nodeToAgent, selectedNodeId])

  const nodeStats = useMemo(() => {
    const byId = new Map(agents.map((a) => [a.agentId, a]))
    const m = new Map<string, { toolCount?: number; tokens?: number }>()
    for (const [nodeId, agentId] of nodeToAgent) {
      const a = byId.get(agentId)
      if (a) m.set(nodeId, { toolCount: a.toolCount, tokens: a.tokens })
    }
    return m
  }, [agents, nodeToAgent])

  const colorIdx = useActiveSession((s) => s.subagentColors[view.toolUseId])
  const colors = useMemo(() => getSubagentColorClasses(colorIdx), [colorIdx])

  const [tab, setTab] = useState<'graph' | 'script' | 'list'>(view.agentId ? 'list' : 'graph')
  const [listAgentId, setListAgentId] = useState<string | null>(view.agentId ?? null)
  const canList = agents.length > 0
  const activeTab: 'graph' | 'script' | 'list' | null =
    tab === 'list' && canList
      ? 'list'
      : tab === 'script' && script
        ? 'script'
        : dag
          ? 'graph'
          : canList
            ? 'list'
            : script
              ? 'script'
              : null
  const listSelected = useMemo(
    () => agents.find((a) => a.agentId === listAgentId) ?? agents[0],
    [agents, listAgentId],
  )
  const agentGroups = useMemo(() => {
    const byPhase = new Map<string | undefined, WorkflowAgentInfo[]>()
    for (const a of agents) {
      const phase = resolveAgentPhase(graph, a)
      const bucket = byPhase.get(phase)
      if (bucket) bucket.push(a)
      else byPhase.set(phase, [a])
    }
    const orderedPhases = graph?.phases?.length
      ? graph.phases
      : (parsedLog?.phases.map((p) => p.title) ?? [])
    const groups: Array<{ phase?: string; agents: WorkflowAgentInfo[] }> = []
    for (const phase of orderedPhases) {
      const bucket = byPhase.get(phase)
      if (bucket) {
        groups.push({ phase, agents: bucket })
        byPhase.delete(phase)
      }
    }
    for (const [phase, bucket] of byPhase) {
      if (phase !== undefined) groups.push({ phase, agents: bucket })
    }
    const noPhase = byPhase.get(undefined)
    if (noPhase) groups.push({ phase: undefined, agents: noPhase })
    return groups
  }, [agents, graph, parsedLog?.phases])

  const [containerWidth, setContainerWidth] = useState(0)
  const isLarge = containerWidth >= 640

  const selectByNode = (node: DagNode): void => {
    if (nodeToAgent.has(node.id)) setSelectedNodeId(node.id)
  }

  const transcript = selected ? (
    <AgentTranscript
      key={selected.agentId}
      agent={selected}
      colors={colors}
      phase={resolveAgentPhase(graph, selected)}
      usesAuthoritativeAgentJsonl={adapter.usesAuthoritativeAgentJsonl}
    />
  ) : null
  const footerOutput = replay?.output ?? parsedLog?.resultText

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border/40 bg-muted/30 px-3 py-2 text-xs">
        <button
          type="button"
          onClick={() => nav.close()}
          title={t('chat.codexCollab.backToMain', 'Back')}
          aria-label={t('chat.codexCollab.backToMain', 'Back')}
          className="inline-flex items-center justify-center rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
        </button>
        <Workflow className={cn('size-3.5 shrink-0', colors.text)} />
        <span className="min-w-0 truncate font-medium text-foreground">{view.name || t('chat.workflow.title', 'Workflow')}</span>
        {(dag || script || canList) && (
          <div className="ml-auto flex shrink-0 items-center gap-0.5 rounded bg-muted/60 p-0.5">
            {dag && (
              <button
                type="button"
                onClick={() => setTab('graph')}
                className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs transition-colors', activeTab === 'graph' ? 'bg-background text-foreground' : 'text-muted-foreground hover:text-foreground')}
              >
                <Network className="size-3" />{t('chat.workflow.graph', 'Graph')}
              </button>
            )}
            {canList && (
              <button
                type="button"
                onClick={() => setTab('list')}
                className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs transition-colors', activeTab === 'list' ? 'bg-background text-foreground' : 'text-muted-foreground hover:text-foreground')}
              >
                <List className="size-3" />{t('chat.workflow.list', 'List')}
              </button>
            )}
            {script && (
              <button
                type="button"
                onClick={() => setTab('script')}
                className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs transition-colors', activeTab === 'script' ? 'bg-background text-foreground' : 'text-muted-foreground hover:text-foreground')}
              >
                <Code className="size-3" />{t('chat.workflow.script', 'Script')}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1">
        {activeTab === 'list' ? (
          <div className="flex h-full min-w-0">
            <div className="w-56 shrink-0 overflow-y-auto border-r border-border/40 py-1">
              {agentGroups.map((group, gi) => (
                <div key={group.phase ?? `__nophase_${gi}`} className="mb-1 last:mb-0">
                  {group.phase && (
                    <div className="px-2.5 pb-0.5 pt-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {group.phase}
                    </div>
                  )}
                  {group.agents.map((a) => (
                    <button
                      key={a.agentId}
                      type="button"
                      onClick={() => setListAgentId(a.agentId)}
                      className={cn(
                        'flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-xs transition-colors',
                        listSelected?.agentId === a.agentId ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/50',
                      )}
                    >
                      <Bot className={cn('size-3 shrink-0', workflowAgentIconClass(a.state, isRunning, colors.text, colors.text))} />
                      <span className="min-w-0 truncate">{a.label}</span>
                      {(a.toolCount > 0 || (a.tokens != null && a.tokens > 0)) && (
                        <span className="ml-auto flex shrink-0 items-center gap-1 text-xs tabular-nums text-muted-foreground">
                          {a.toolCount > 0 && (
                            <span className="inline-flex items-center gap-0.5">
                              <Wrench className="size-2.5" />
                              {a.toolCount}
                            </span>
                          )}
                          {a.tokens != null && a.tokens > 0 && (
                            <span>{formatTokens(a.tokens)}</span>
                          )}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {listSelected ? (
                <div className="chat-md mx-auto w-full min-w-0 max-w-3xl px-4 py-3">
                  <AgentTranscript
                    key={listSelected.agentId}
                    agent={listSelected}
                    colors={colors}
                    phase={resolveAgentPhase(graph, listSelected)}
                    usesAuthoritativeAgentJsonl={adapter.usesAuthoritativeAgentJsonl}
                  />
                </div>
              ) : (
                <div className="flex h-full items-center justify-center px-3 text-xs text-muted-foreground">
                  {t('chat.workflow.selectAgent', 'Select an agent')}
                </div>
              )}
            </div>
          </div>
        ) : activeTab === 'script' && script ? (
          <div className="h-full overflow-auto bg-muted/10 px-3 py-3 text-xs">
            {childScripts.length === 0 ? (
              <HighlightedCodeBlock
                code={script}
                language={resolvedScriptLanguage}
                codePlugin={codePlugin}
              />
            ) : (
              <>
                <ScriptSection
                  label={view.name || t('chat.workflow.title', 'Workflow')}
                  path={loadedFromPath ?? view.scriptPath}
                  code={script}
                  fallbackLanguage={adapter.defaultLanguage}
                />
                {childScripts.map((cs) => (
                  <ScriptSection
                    key={cs.scriptPath}
                    label={`▸ ${cs.name ?? t('chat.workflow.subWorkflow', 'sub-workflow')}`}
                    path={cs.scriptPath}
                    code={cs.source}
                    fallbackLanguage={adapter.defaultLanguage}
                  />
                ))}
              </>
            )}
          </div>
        ) : activeTab === 'graph' && dag ? (
          !isLarge && selected ? (
            <div className="flex h-full flex-col">
              <div className="flex shrink-0 items-center gap-2 border-b border-border/40 px-3 py-1.5 text-xs">
                <button
                  type="button"
                  onClick={() => setSelectedNodeId(null)}
                  className="inline-flex items-center justify-center rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <ArrowLeft className="size-3.5" />
                </button>
                <div className="min-w-0 flex-1">
                  <TranscriptHeader agent={selected} colors={colors} isRunning={isRunning} />
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="chat-md mx-auto w-full min-w-0 max-w-3xl px-3 py-3">{transcript}</div>
              </div>
            </div>
          ) : (
            <WorkflowDagCanvas
              dag={dag}
              selectedNodeId={selectedNodeId ?? undefined}
              onSelectNode={selectByNode}
              stats={nodeStats}
              onContainerWidth={setContainerWidth}
              overlayHeader={isLarge && selected ? <TranscriptHeader agent={selected} colors={colors} isRunning={isRunning} /> : undefined}
              overlayContent={isLarge && transcript ? <div className="chat-md">{transcript}</div> : undefined}
              onCloseOverlay={() => setSelectedNodeId(null)}
            />
          )
        ) : (
          <div className="flex h-full items-center justify-center px-3 text-xs text-muted-foreground">
            {t('chat.workflow.noGraph', 'No workflow graph available')}
          </div>
        )}
      </div>

      {footerOutput != null && <WorkflowOutputFooter output={footerOutput} />}
    </div>
  )
}
