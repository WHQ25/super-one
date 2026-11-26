import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bot, ChevronRight, Wrench } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import { Streamdown } from 'streamdown'
import type { SubagentColorClasses } from './subagent-colors'
import { HighlightedCodeBlock } from './CodeBlock'
import type { WorkflowAgentInfo } from './use-workflow-agents'
import { useSubagentJsonl } from './use-subagent-jsonl'
import { renderJsonlEntry } from './subagent-activity'
import { NestedToolContext } from './nested-tool-context'
import { StructuredOutputView } from './StructuredOutputView'
import {
  detectWorkflowScriptLanguage,
  workflowAgentIconClass,
  type WorkflowScriptLanguage,
} from './workflow-utils'
import {
  streamdownPlugins,
  streamdownRehypePlugins,
  streamdownControls,
  streamdownComponents,
  streamdownLinkSafety,
  codePlugin,
  formatTokens,
} from './chat-shared'

export function AgentTranscript({
  agent,
  colors,
  phase,
  usesAuthoritativeAgentJsonl,
}: {
  agent: WorkflowAgentInfo
  colors: SubagentColorClasses
  phase?: string
  usesAuthoritativeAgentJsonl: (jsonlPath: string) => boolean
}) {
  const { t } = useTranslation()
  const isJsonlTranscript = !!agent.jsonlPath && agent.jsonlPath.endsWith('.jsonl')
  const transcriptUnavailable = agent.transcriptAvailable === false || !isJsonlTranscript
  const { entries, resultText } = useSubagentJsonl({
    toolUseId: agent.agentId,
    outputFile: isJsonlTranscript ? agent.jsonlPath : undefined,
    enabled: isJsonlTranscript,
    isRunning: false,
    skipAuthoritativeRead: isJsonlTranscript && !usesAuthoritativeAgentJsonl(agent.jsonlPath),
  })
  const finalText = agent.resultText ?? resultText
  const hasActivity = entries.length > 0 || !!finalText
  const lastEntry = entries[entries.length - 1]
  const hasFinalActivity = lastEntry?.type === 'activity' && lastEntry.text.trim() === finalText?.trim()
  const showFinalOutput = Boolean(finalText) && (entries.length === 0 || !hasFinalActivity)

  return (
    <div className="space-y-2">
      {agent.prompt && (
        <div className="mb-3">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <span>{t('chat.subagent.prompt')}</span>
            {phase && <span className="rounded bg-muted px-1 py-px text-xs normal-case">{phase}</span>}
            {agent.toolCount > 0 && (
              <span className="inline-flex items-center gap-0.5 rounded bg-muted px-1 py-px text-xs normal-case tabular-nums">
                <Wrench className="size-2.5" />
                {agent.toolCount}
              </span>
            )}
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
          {transcriptUnavailable
            ? t('chat.workflow.transcriptUnavailableEmpty', 'Tool-level transcript is unavailable for this agent.')
            : t('chat.subagent.noActivity', 'No activity recorded')}
        </div>
      )}
      <NestedToolContext.Provider value={{ defaultAutoExpand: false }}>
        <div className="space-y-1">
          {entries.map((entry, i) => renderJsonlEntry(entry, i))}
        </div>
      </NestedToolContext.Provider>
      {showFinalOutput && finalText && (
        <>
          {transcriptUnavailable && (
            <div className="rounded border border-border/40 bg-muted/30 px-2.5 py-1.5 text-xs text-muted-foreground">
              {t('chat.workflow.transcriptUnavailable', 'Tool-level transcript is unavailable for this agent; showing final output.')}
            </div>
          )}
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
        </>
      )}
    </div>
  )
}

export function TranscriptHeader({ agent, colors, isRunning }: {
  agent: WorkflowAgentInfo
  colors: SubagentColorClasses
  isRunning: boolean
}) {
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-xs">
      <Bot className={cn('size-3.5 shrink-0', workflowAgentIconClass(agent.state, isRunning, colors.text, colors.text))} />
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

export function WorkflowOutputFooter({ output }: { output: unknown }) {
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

export function ScriptSection({
  label,
  path,
  code,
  fallbackLanguage,
}: {
  label: string
  path?: string
  code: string
  fallbackLanguage: WorkflowScriptLanguage
}) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1 flex items-baseline gap-1.5">
        <span className="shrink-0 text-xs font-medium text-foreground">{label}</span>
        {path && <span className="min-w-0 truncate text-xs text-muted-foreground opacity-70">{path}</span>}
      </div>
      <HighlightedCodeBlock
        code={code}
        language={detectWorkflowScriptLanguage(code, path, fallbackLanguage)}
        codePlugin={codePlugin}
      />
    </div>
  )
}
