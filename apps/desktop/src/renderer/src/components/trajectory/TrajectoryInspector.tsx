import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@superone/ui/components/ui/tabs'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import type {
  TrajectoryPayload,
  TrajectoryProjection,
  TrajectoryRecord,
} from '@superone/shared/trajectory-types'
import { PromptDiff } from './PromptDiff'
import { formatClock, formatDuration, formatJson, formatTokens } from './trajectory-format'

/** A payload pane: the exact text, plus what the transport bound dropped. */
function Payload({ payload, empty }: { payload: TrajectoryPayload | null; empty: string }) {
  const { t } = useTranslation()
  if (payload === null || payload.text.length === 0) {
    return <div className="p-3 text-[11px] text-muted-foreground">{empty}</div>
  }
  return (
    <div className="flex flex-col">
      <pre className="whitespace-pre-wrap break-words p-3 font-mono text-[11px] leading-5">{payload.text}</pre>
      {payload.truncatedChars !== undefined && (
        <div className="border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
          {t('trajectory.inspector.truncated', { count: payload.truncatedChars })}
        </div>
      )}
    </div>
  )
}

/** A label/value grid for the metric panes. */
function Facts({ rows }: { rows: Array<[string, string]> }) {
  return (
    <table className="w-full py-2 text-[11px]">
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label}>
            <td className="w-36 py-0.5 pl-3 pr-2 text-muted-foreground">{label}</td>
            <td className="py-0.5 pr-3 font-mono">{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** The tab ids each record kind exposes, in display order. */
function tabsFor(record: TrajectoryRecord): string[] {
  switch (record.kind) {
    case 'system':
      return record.change === null ? ['prompt', 'tools'] : ['changes', 'prompt', 'tools']
    case 'user':
      return ['content']
    case 'context':
      return record.sections === null ? ['content', 'source'] : ['content', 'sections', 'source']
    case 'message':
      return record.thinking === null ? ['text', 'metrics'] : ['text', 'thinking', 'metrics']
    case 'tool':
      return ['arguments', 'result', 'schema']
    case 'compacted':
      return ['summary']
    case 'approval':
    case 'preset':
      return ['source']
  }
}

export interface TrajectoryInspectorProps {
  projection: TrajectoryProjection
  record: TrajectoryRecord
  onClose: () => void
}

/** Local inspection of one record: its exact payloads, schema, and accounting. */
export function TrajectoryInspector({ projection, record, onClose }: TrajectoryInspectorProps) {
  const { t } = useTranslation()
  const tabs = useMemo(() => tabsFor(record), [record])
  const [tab, setTab] = useState(tabs[0]!)
  // A new selection may not have the previously active tab.
  const active = tabs.includes(tab) ? tab : tabs[0]!

  const request = record.request === null ? null : projection.requests[record.request - 1] ?? null
  const header = record.kind === 'system' ? projection.headers[record.header] ?? null : null

  return (
    <div className="flex h-full flex-col border-l border-border bg-background">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
        <span className="font-mono text-[11px] text-muted-foreground">#{record.index}</span>
        <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground/70">
          {t(`trajectory.kind.${record.kind}`)}
        </span>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground/60">
          {formatClock(record.startedAt)} · {formatDuration(record.durationMs)}
        </span>
        <IconButton size="xs" variant="nested" tooltip={t('common.close')} onClick={onClose}>
          <X />
        </IconButton>
      </div>

      <Tabs value={active} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col gap-0">
        <TabsList className="shrink-0 justify-start rounded-none border-b border-border bg-transparent px-2">
          {tabs.map((id) => (
            <TabsTrigger key={id} value={id} className="text-[11px]">
              {t(`trajectory.inspector.${id}`)}
            </TabsTrigger>
          ))}
        </TabsList>

        <div className="min-h-0 flex-1 overflow-auto">
          {record.kind === 'system' && header !== null && (
            <>
              {record.change !== null && (
                <TabsContent value="changes"><PromptDiff diff={record.change} /></TabsContent>
              )}
              <TabsContent value="prompt">
                <Payload payload={header.system} empty={t('trajectory.inspector.noPrompt')} />
              </TabsContent>
              <TabsContent value="tools">
                {header.tools.length === 0
                  ? <div className="p-3 text-[11px] text-muted-foreground">{t('trajectory.inspector.noTools')}</div>
                  : (
                    <ul className="flex flex-col gap-2 p-3">
                      {header.tools.map((tool) => (
                        <li key={tool.name} className="flex flex-col gap-0.5">
                          <span className="font-mono text-[11px]">{tool.name}</span>
                          <span className="text-[11px] text-muted-foreground">{tool.description}</span>
                        </li>
                      ))}
                    </ul>
                  )}
              </TabsContent>
            </>
          )}

          {record.kind === 'user' && (
            <TabsContent value="content">
              <Payload payload={record.content} empty={t('trajectory.inspector.noContent')} />
            </TabsContent>
          )}

          {record.kind === 'context' && (
            <>
              <TabsContent value="content">
                <Payload payload={record.content} empty={t('trajectory.inspector.noContent')} />
              </TabsContent>
              {record.sections !== null && (
                <TabsContent value="sections">
                  <div className="flex flex-col gap-3 p-3">
                    {record.sections.map((section) => (
                      <section key={section.name} className="flex flex-col gap-1">
                        <h4 className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground/70">
                          {section.name}
                        </h4>
                        <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-5">
                          {section.text}
                        </pre>
                      </section>
                    ))}
                  </div>
                </TabsContent>
              )}
              <TabsContent value="source">
                <Facts rows={[
                  [t('trajectory.inspector.producer'), record.producer],
                  [t('trajectory.inspector.form'), record.form ?? '—'],
                  [t('trajectory.inspector.notice'), record.notice ?? '—'],
                ]}
                />
              </TabsContent>
            </>
          )}

          {record.kind === 'message' && (
            <>
              <TabsContent value="text">
                <Payload payload={record.text} empty={t('trajectory.inspector.noContent')} />
              </TabsContent>
              {record.thinking !== null && (
                <TabsContent value="thinking">
                  <Payload payload={record.thinking} empty={t('trajectory.inspector.noContent')} />
                </TabsContent>
              )}
              <TabsContent value="metrics">
                <Facts rows={[
                  [t('trajectory.inspector.provider'), record.provider],
                  [t('trajectory.inspector.model'), record.model],
                  [t('trajectory.inspector.ttft'), formatDuration(record.ttftMs)],
                  [t('trajectory.inspector.duration'), formatDuration(record.durationMs)],
                  [t('trajectory.inspector.input'), formatTokens(record.usage?.input ?? null)],
                  [t('trajectory.inspector.output'), formatTokens(record.usage?.output ?? null)],
                  [t('trajectory.inspector.cacheRead'), formatTokens(record.usage?.cacheRead ?? null)],
                  [t('trajectory.inspector.cacheWrite'), formatTokens(record.usage?.cacheWrite ?? null)],
                  [t('trajectory.inspector.reasoning'), formatTokens(record.usage?.reasoning ?? null)],
                ]}
                />
              </TabsContent>
            </>
          )}

          {record.kind === 'tool' && (
            <>
              <TabsContent value="arguments">
                <Payload
                  payload={{ ...record.args, text: formatJson(record.args.text) }}
                  empty={t('trajectory.inspector.noContent')}
                />
              </TabsContent>
              <TabsContent value="result">
                <Payload payload={record.result} empty={t('trajectory.inspector.stillRunning')} />
              </TabsContent>
              <TabsContent value="schema">
                {record.schema === null
                  ? <div className="p-3 text-[11px] text-muted-foreground">{t('trajectory.inspector.noSchema')}</div>
                  : (
                    <div className="flex flex-col gap-2 p-3">
                      <p className="text-[11px] text-muted-foreground">{record.schema.description}</p>
                      <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-5">
                        {JSON.stringify(record.schema.parameters, null, 2)}
                      </pre>
                    </div>
                  )}
              </TabsContent>
            </>
          )}

          {record.kind === 'compacted' && (
            <TabsContent value="summary">
              <Facts rows={[
                [t('trajectory.inspector.trigger'), record.trigger],
                [t('trajectory.inspector.preTokens'), formatTokens(record.preTokens)],
                [t('trajectory.inspector.postTokens'), formatTokens(record.postTokens)],
              ]}
              />
              <Payload payload={record.compactionSummary} empty={t('trajectory.inspector.noContent')} />
            </TabsContent>
          )}

          {record.kind === 'preset' && (
            <TabsContent value="source">
              <Facts rows={[[t('trajectory.inspector.preset'), record.preset]]} />
            </TabsContent>
          )}

          {record.kind === 'approval' && (
            <TabsContent value="source">
              <Facts rows={[
                [t('trajectory.inspector.toolName'), record.toolName],
                [t('trajectory.inspector.callId'), record.callId ?? '—'],
                [t('trajectory.inspector.reason'), record.reason ?? '—'],
                [t('trajectory.inspector.outcome'), record.outcome ?? t('trajectory.inspector.stillRunning')],
              ]}
              />
            </TabsContent>
          )}
        </div>
      </Tabs>

      {request !== null && (
        <div className="shrink-0 border-t border-border py-2">
          <h4 className="px-3 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">
            {t('trajectory.request', { ordinal: request.ordinal })}
          </h4>
          <Facts rows={[
            [t('trajectory.inspector.purpose'), request.purpose],
            [t('trajectory.inspector.route'), request.route === null
              ? '—'
              : `${request.route.provider} / ${request.route.model}`],
            [t('trajectory.inspector.contextWindow'), formatTokens(request.route?.contextWindow ?? null)],
            [t('trajectory.inspector.duration'), formatDuration(request.durationMs)],
          ]}
          />
        </div>
      )}
    </div>
  )
}
