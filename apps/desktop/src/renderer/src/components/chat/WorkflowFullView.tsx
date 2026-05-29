import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Workflow, Bot, Wrench } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import { Streamdown } from 'streamdown'
import { useWorkflowNavigation, type WorkflowViewState } from './workflow-navigation-context'
import { useWorkflowAgents, type WorkflowAgentInfo } from './use-workflow-agents'
import { parseWorkflowGraph } from './workflow-graph'
import { buildDag } from './workflow-dag'
import { WorkflowDag } from './WorkflowDag'
import { useSubagentJsonl } from './use-subagent-jsonl'
import { AsyncToolRow } from './subagent-activity'
import type { JsonlEntry } from './subagent-utils'
import {
  streamdownPlugins,
  streamdownRehypePlugins,
  streamdownControls,
  streamdownComponents,
  streamdownLinkSafety,
} from './chat-shared'

function AgentTranscript({ agent }: { agent: WorkflowAgentInfo }) {
  const { t } = useTranslation()
  const { entries, resultText } = useSubagentJsonl({
    toolUseId: agent.agentId,
    outputFile: agent.jsonlPath,
    enabled: true,
    isRunning: false,
  })
  const finalText = resultText ?? agent.resultText

  if (entries.length === 0 && !finalText) {
    return (
      <div className="px-1 py-2 text-xs text-muted-foreground">
        {t('chat.subagent.noActivity', 'No activity recorded')}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {entries.map((entry, i) => renderEntry(entry, i))}
      {finalText && (
        <div className="mt-3 border-t border-border/30 pt-3">
          <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {t('chat.subagent.output')}
          </div>
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
        </div>
      )}
    </div>
  )
}

function renderEntry(entry: JsonlEntry, index: number) {
  if (entry.type === 'tool') {
    return <AsyncToolRow key={index} toolName={entry.toolName} description={entry.description} isActive={false} />
  }
  return (
    <Streamdown
      key={index}
      className="chat-md text-xs"
      plugins={streamdownPlugins}
      rehypePlugins={streamdownRehypePlugins}
      components={streamdownComponents}
      controls={streamdownControls}
      linkSafety={streamdownLinkSafety}
    >
      {entry.text}
    </Streamdown>
  )
}

export function WorkflowFullView({ view }: { view: WorkflowViewState }) {
  const { t } = useTranslation()
  const nav = useWorkflowNavigation()
  const agents = useWorkflowAgents(view.transcriptDir, true)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const selected = useMemo(
    () => agents.find((a) => a.agentId === selectedId) ?? agents[0],
    [agents, selectedId],
  )

  const dag = useMemo(() => {
    if (!view.script) return null
    const graph = parseWorkflowGraph(view.script)
    return graph.blocks.length > 0 ? buildDag(graph) : null
  }, [view.script])

  const selectByLabel = (label: string): void => {
    const match = agents.find((a) => a.label === label)
    if (match) setSelectedId(match.agentId)
  }

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
        <Workflow className="size-3.5 shrink-0 text-primary" />
        <span className="min-w-0 truncate font-medium text-foreground">{view.name || t('chat.workflow.title', 'Workflow')}</span>
        <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{agents.length} {t('chat.workflow.agents', 'Agents')}</span>
      </div>

      {dag && (
        <div className="max-h-64 shrink-0 overflow-auto border-b border-border/40 bg-muted/10 px-2 py-2">
          <WorkflowDag dag={dag} selectedLabel={selected?.label} onSelect={selectByLabel} />
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="w-56 shrink-0 overflow-y-auto border-r border-border/40 py-1">
          {agents.length === 0 && (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              {t('chat.workflow.noAgents', 'No agent transcripts found')}
            </div>
          )}
          {agents.map((agent) => (
            <button
              key={agent.agentId}
              type="button"
              onClick={() => setSelectedId(agent.agentId)}
              className={cn(
                'flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-[11px] transition-colors',
                selected?.agentId === agent.agentId ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/50',
              )}
            >
              <Bot className="size-3 shrink-0" />
              <span className="min-w-0 truncate">{agent.label}</span>
              {agent.toolCount > 0 && (
                <span className="ml-auto inline-flex shrink-0 items-center gap-0.5">
                  <Wrench className="size-2.5" />
                  {agent.toolCount}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="min-w-0 flex-1 overflow-y-auto">
          <div className="chat-md mx-auto w-full min-w-0 max-w-3xl px-3 py-3">
            {selected ? (
              <AgentTranscript key={selected.agentId} agent={selected} />
            ) : (
              <div className="px-1 py-2 text-xs text-muted-foreground">
                {t('chat.workflow.selectAgent', 'Select an agent to view its transcript')}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
