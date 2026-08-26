import { useState, useMemo, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Workflow, Network, Code, Bot, Wrench, List, ChevronRight } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import { Streamdown } from 'streamdown'
import { useWorkflowNavigation, type WorkflowViewState } from './workflow-navigation-context'
import { useActiveSession } from '@/stores/chat'
import { getSubagentColorClasses, type SubagentColorClasses } from './subagent-colors'
import { HighlightedCodeBlock } from './CodeBlock'
import { useWorkflowAgents, type WorkflowAgentInfo } from './use-workflow-agents'
import { useResolvedWorkflowGraph } from './use-workflow-graph'
import { useWorkflowReplay } from './use-workflow-replay'
import type { ReplayAgentRecord } from './workflow-replay'
import {
  buildDag,
  resolveAgentPhase,
  bindAgentsToDag,
  runtimeStatusFromAgentState,
  type DagNode,
  type DagRuntimeAgent,
} from './workflow-dag'
import { WorkflowDagCanvas } from './WorkflowDagCanvas'
import { useSubagentJsonl } from './use-subagent-jsonl'
import { renderJsonlEntry } from './subagent-activity'
import { NestedToolContext } from './nested-tool-context'
import { StructuredOutputView } from './StructuredOutputView'
import { looksLikeRhaiWorkflow } from './workflow-graph-rhai'
import { workflowArtifactPath } from './workflow-utils'
import {
  streamdownPlugins,
  streamdownRehypePlugins,
  streamdownControls,
  streamdownComponents,
  streamdownLinkSafety,
  codePlugin,
  formatTokens,
} from './chat-shared'

function AgentTranscript({ agent, colors, phase }: { agent: WorkflowAgentInfo; colors: SubagentColorClasses; phase?: string }) {
  const { t } = useTranslation()
  // Claude: agent-*.jsonl. Grok: child-session chat_history.jsonl (tool_calls + tool_result).
  // output.json alone is final text only — still useful as resultText fallback.
  const isJsonlTranscript = !!agent.jsonlPath && agent.jsonlPath.endsWith('.jsonl')
  const { entries, resultText } = useSubagentJsonl({
    toolUseId: agent.agentId,
    outputFile: isJsonlTranscript ? agent.jsonlPath : undefined,
    enabled: isJsonlTranscript,
    isRunning: false,
    // Skip Claude SDK authoritative read for Grok paths (not agent-<id>.jsonl layout).
    skipAuthoritativeRead: isJsonlTranscript && !/agent-[^/\\]+\.jsonl$/.test(agent.jsonlPath),
  })
  // Prefer the full final report from output.json when present; chat_history text is turn-level.
  const finalText = agent.resultText ?? resultText
  const hasActivity = entries.length > 0 || !!finalText

  return (
    <div className="space-y-2">
      {agent.prompt && (
        <div className="mb-3">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <span>{t('chat.subagent.prompt')}</span>
            {phase && <span className="rounded bg-muted px-1 py-px text-xs normal-case">{phase}</span>}
            {agent.tokens != null && agent.tokens > 0 && (
              <span className="rounded bg-muted px-1 py-px text-xs normal-case tabular-nums">{formatTokens(agent.tokens)}</span>
            )}
          </div>
          <div className={cn('whitespace-pre-wrap rounded border-l-2 bg-muted/30 px-3 py-2 text-xs leading-relaxed text-foreground', colors.borderL)}>
            {agent.prompt}
          </div>
        </div>
      )}
      {!hasActivity && (
        <div className="px-1 py-2 text-xs text-muted-foreground">
          {t('chat.subagent.noActivity', 'No activity recorded')}
        </div>
      )}
      <NestedToolContext.Provider value={{ defaultAutoExpand: false }}>
        <div className="space-y-1">
          {entries.map((entry, i) => renderJsonlEntry(entry, i))}
        </div>
      </NestedToolContext.Provider>
      {entries.length === 0 && finalText && (
        <Streamdown
          className="chat-md text-xs"
          plugins={streamdownPlugins}
          rehypePlugins={streamdownRehypePlugins}
          components={streamdownComponents}
          controls={streamdownControls}
          linkSafety={streamdownLinkSafety}
        >
          {finalText}
        </Streamdown>
      )}
    </div>
  )
}

function TranscriptHeader({ agent, colors }: { agent: WorkflowAgentInfo; colors: SubagentColorClasses }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-xs">
      <Bot className={cn('size-3.5 shrink-0', colors.text)} />
      <span className="min-w-0 truncate font-medium text-foreground">{agent.label}</span>
      <span className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
        {agent.toolCount > 0 && (
          <span className="inline-flex items-center gap-0.5">
            <Wrench className="size-2.5" />
            {agent.toolCount}
          </span>
        )}
        {agent.tokens != null && agent.tokens > 0 && (
          <>
            {agent.toolCount > 0 && <span>·</span>}
            <span className="tabular-nums">{formatTokens(agent.tokens)}</span>
          </>
        )}
      </span>
    </div>
  )
}

function WorkflowOutputFooter({ output }: { output: unknown }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <div className="shrink-0 border-t border-border/40 bg-muted/20">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronRight className={cn('size-3 transition-transform', open && 'rotate-90')} />
        {t('chat.workflow.output', 'Output')}
      </button>
      {open && (
        <div className="max-h-72 overflow-y-auto px-3 pb-2">
          <StructuredOutputView data={output} fill />
        </div>
      )}
    </div>
  )
}

function scriptLanguage(code: string, path?: string): string {
  // Official TextMate grammar via rhai-highlight (not a Shiki bundled lang).
  if (path?.endsWith('.rhai') || looksLikeRhaiWorkflow(code)) return 'rhai'
  if (path?.endsWith('.js') || path?.endsWith('.ts')) return 'javascript'
  return 'javascript'
}

function ScriptSection({ label, path, code }: { label: string; path?: string; code: string }) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1 flex items-baseline gap-1.5">
        <span className="shrink-0 text-xs font-medium text-foreground">{label}</span>
        {path && <span className="min-w-0 truncate text-xs text-muted-foreground opacity-70">{path}</span>}
      </div>
      <HighlightedCodeBlock code={code} language={scriptLanguage(code, path)} codePlugin={codePlugin} />
    </div>
  )
}

export function WorkflowFullView({ view }: { view: WorkflowViewState }) {
  const { t } = useTranslation()
  const nav = useWorkflowNavigation()
  const diskAgents = useWorkflowAgents(view.transcriptDir, true)
  const liveRows = useActiveSession((s) => {
    const byTool = s.taskProgress[view.toolUseId]
    if (byTool?.workflowAgents?.length) return byTool.workflowAgents
    // Grok may key progress by run_id after launch correlation.
    for (const entry of Object.values(s.taskProgress)) {
      if (entry.workflowAgents?.length && entry.taskId && view.transcriptDir?.includes(entry.taskId)) {
        return entry.workflowAgents
      }
    }
    return undefined
  })
  // Annotated because the live-only branch omits the optional prompt/result
  // fields, which would otherwise widen this into a union that drops them.
  const agents = useMemo<WorkflowAgentInfo[]>(() => {
    if (!liveRows?.length) return diskAgents
    if (diskAgents.length === 0) {
      return liveRows.map((a, i) => ({
        agentId: a.agentId ?? `live-${a.label}-${i}`,
        jsonlPath: '',
        label: a.label,
        toolCount: a.toolCount,
        tokens: a.tokens,
        phase: a.phase,
        state: a.state,
      }))
    }
    return diskAgents.map((a) => {
      const live = liveRows.find(
        (r) => (r.agentId && r.agentId === a.agentId) || r.label === a.label,
      )
      if (!live) return a
      return {
        ...a,
        phase: a.phase ?? live.phase,
        state: live.state ?? a.state,
        tokens: a.tokens ?? live.tokens,
        toolCount: a.toolCount || live.toolCount,
      }
    })
  }, [diskAgents, liveRows])
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [loadedScript, setLoadedScript] = useState<string | undefined>(view.script)
  const [loadedFromPath, setLoadedFromPath] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (view.script) {
      setLoadedScript(view.script)
      setLoadedFromPath(undefined)
      return
    }
    let cancelled = false
    const candidates = [
      view.scriptPath,
      workflowArtifactPath(view.transcriptDir, 'script.rhai'),
      workflowArtifactPath(view.transcriptDir, 'script.js'),
    ].filter((p): p is string => !!p)

    void (async () => {
      for (const path of candidates) {
        const src = await Promise.resolve(window.app.readWorkflowScript?.(path)).catch(() => null)
        if (cancelled) return
        if (typeof src === 'string' && src.length > 0) {
          setLoadedScript(src)
          setLoadedFromPath(path)
          return
        }
      }
      if (!cancelled) {
        setLoadedScript(undefined)
        setLoadedFromPath(undefined)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [view.script, view.scriptPath, view.transcriptDir])

  const script = loadedScript
  const { graph, childScripts } = useResolvedWorkflowGraph(script)
  const records = useMemo<ReplayAgentRecord[]>(
    () => agents.map((a) => ({ agentId: a.agentId, prompt: a.prompt, label: a.label, result: a.result, toolCount: a.toolCount })),
    [agents],
  )
  const childWorkflowMap = useMemo(
    () => new Map(childScripts.map((cs) => [cs.scriptPath, { source: cs.source, name: cs.name }])),
    [childScripts],
  )
  // Runtime rows for graph expansion (Grok labels / Claude fan-out without full JS replay).
  const runtimeAgents = useMemo<DagRuntimeAgent[]>(
    () => agents.map((a) => ({
      label: a.label,
      prompt: a.prompt,
      agentId: a.agentId,
      status: runtimeStatusFromAgentState(a.state),
      toolCount: a.toolCount,
    })),
    [agents],
  )
  // JS replay only — Rhai cannot execute; use static graph + runtime label binding.
  const replay = useWorkflowReplay(
    script && !looksLikeRhaiWorkflow(script) ? script : undefined,
    records,
    childWorkflowMap,
  )
  const dag = useMemo(
    () => {
      if (replay) return replay.dag
      if (!graph || graph.blocks.length === 0) return null
      // Pass runtime so parallel(catalog:*) expands to one node per live agent.
      return buildDag(graph, runtimeAgents.length > 0 ? runtimeAgents : undefined)
    },
    [replay, graph, runtimeAgents],
  )

  const nodeToAgent = useMemo(
    () => {
      if (replay) return replay.nodeAgentIds
      if (!dag) return new Map<string, string>()
      return bindAgentsToDag(dag, agents, dag.nodeAgentIds)
    },
    [replay, dag, agents],
  )
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

  const [tab, setTab] = useState<'graph' | 'script' | 'list'>('graph')
  const [listAgentId, setListAgentId] = useState<string | null>(null)
  const canList = agents.length > 0
  const activeTab: 'graph' | 'script' | 'list' | null =
    tab === 'list' && canList
      ? 'list'
      : tab === 'script' && script
        ? 'script'
        : dag
          ? 'graph'
          : script
            ? 'script'
            : canList
              ? 'list'
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
    const groups: Array<{ phase?: string; agents: WorkflowAgentInfo[] }> = []
    for (const phase of graph?.phases ?? []) {
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
  }, [agents, graph])

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
    />
  ) : null

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
                      <Bot className={cn('size-3 shrink-0', colors.text)} />
                      <span className="min-w-0 truncate">{a.label}</span>
                      {a.state && (
                        <span className="shrink-0 text-xs text-muted-foreground/80">{a.state}</span>
                      )}
                      {a.tokens != null && a.tokens > 0 && (
                        <span className="ml-auto shrink-0 tabular-nums text-xs text-muted-foreground">{formatTokens(a.tokens)}</span>
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
                language={scriptLanguage(script, loadedFromPath ?? view.scriptPath)}
                codePlugin={codePlugin}
              />
            ) : (
              <>
                <ScriptSection
                  label={view.name || t('chat.workflow.title', 'Workflow')}
                  path={loadedFromPath ?? view.scriptPath}
                  code={script}
                />
                {childScripts.map((cs) => (
                  <ScriptSection key={cs.scriptPath} label={`▸ ${cs.name ?? t('chat.workflow.subWorkflow', 'sub-workflow')}`} path={cs.scriptPath} code={cs.source} />
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
                  <TranscriptHeader agent={selected} colors={colors} />
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
              overlayHeader={isLarge && selected ? <TranscriptHeader agent={selected} colors={colors} /> : undefined}
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

      {replay?.output != null && <WorkflowOutputFooter output={replay.output} />}
    </div>
  )
}
