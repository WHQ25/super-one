import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUpRight, X } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@superone/ui/components/ui/tabs'
import { Button } from '@superone/ui/components/ui/button'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import type { TrajectoryProjection, TrajectoryRecord } from '@superone/shared/trajectory-types'
import { PromptDiff } from './PromptDiff'
import { Facts, Payload, TrajectoryImage } from './TrajectoryPayloadView'
import { formatClock, formatDuration, formatJson, formatTokens } from './trajectory-format'

/** The images a record's content blocks reference, in model order. */
function imagesOf(record: TrajectoryRecord) {
  if (record.kind !== 'user' && record.kind !== 'context' && record.kind !== 'message') return []
  return record.blocks.flatMap((block) => (block.image === undefined ? [] : [block.image]))
}

/** The tab ids each record kind exposes, in display order. */
function tabsFor(record: TrajectoryRecord): string[] {
  const images = imagesOf(record).length > 0 ? ['images'] : []
  switch (record.kind) {
    case 'system':
      return record.change === null ? ['prompt', 'tools'] : ['changes', 'prompt', 'tools']
    case 'user':
      return ['content', ...images]
    case 'context':
      return [
        'content',
        ...(record.sections === null ? [] : ['sections']),
        ...images,
        'source',
      ]
    case 'message':
      return ['text', ...(record.thinking === null ? [] : ['thinking']), ...images, 'metrics']
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
  /** The SuperOne session, for on-demand payload and image reads. */
  sessionId: string
  onClose: () => void
  /** Select the call this record belongs to. */
  onSelectRequest: (ordinal: number) => void
}

/** Local inspection of one record: its exact payloads, schema, and accounting. */
export function TrajectoryInspector({
  projection,
  record,
  sessionId,
  onClose,
  onSelectRequest,
}: TrajectoryInspectorProps) {
  const { t } = useTranslation()
  const tabs = useMemo(() => tabsFor(record), [record])
  const [tab, setTab] = useState(tabs[0]!)
  // A new selection may not have the previously active tab.
  const active = tabs.includes(tab) ? tab : tabs[0]!
  const images = useMemo(() => imagesOf(record), [record])

  const header = record.kind === 'system' ? projection.headers[record.header] ?? null : null

  return (
    <div className="flex h-full flex-col border-l border-border">
      <div className="flex shrink-0 items-center gap-2 px-3 py-1.5">
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
        <div className="shrink-0 px-2 pb-1">
          <TabsList className="w-full">
          {tabs.map((id) => (
            <TabsTrigger key={id} value={id} className="text-[11px]">
              {t(`trajectory.inspector.${id}`)}
            </TabsTrigger>
          ))}
          </TabsList>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {images.length > 0 && (
            <TabsContent value="images">
              <div className="flex flex-col gap-3 p-3">
                {images.map((image) => (
                  <TrajectoryImage key={image.attachmentId} image={image} sessionId={sessionId} />
                ))}
              </div>
            </TabsContent>
          )}

          {record.kind === 'system' && header !== null && (
            <>
              {record.change !== null && (
                <TabsContent value="changes"><PromptDiff diff={record.change} /></TabsContent>
              )}
              <TabsContent value="prompt">
                <Payload
                  payload={header.system}
                  empty={t('trajectory.inspector.noPrompt')}
                  sessionId={sessionId}
                  recordId={`header:${header.index}`}
                  field="system"
                />
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
              <Payload
                payload={record.content}
                empty={t('trajectory.inspector.noContent')}
                sessionId={sessionId}
                recordId={record.id}
                field="content"
              />
            </TabsContent>
          )}

          {record.kind === 'context' && (
            <>
              <TabsContent value="content">
                <Payload
                  payload={record.content}
                  empty={t('trajectory.inspector.noContent')}
                  sessionId={sessionId}
                  recordId={record.id}
                  field="content"
                />
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
                <Payload
                  payload={record.text}
                  empty={t('trajectory.inspector.noContent')}
                  sessionId={sessionId}
                  recordId={record.id}
                  field="text"
                />
              </TabsContent>
              {record.thinking !== null && (
                <TabsContent value="thinking">
                  <Payload
                    payload={record.thinking}
                    empty={t('trajectory.inspector.noContent')}
                    sessionId={sessionId}
                    recordId={record.id}
                    field="thinking"
                  />
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
                  payload={record.args}
                  empty={t('trajectory.inspector.noContent')}
                  sessionId={sessionId}
                  recordId={record.id}
                  field="args"
                  format={formatJson}
                />
              </TabsContent>
              <TabsContent value="result">
                <Payload
                  payload={record.result}
                  empty={t('trajectory.inspector.stillRunning')}
                  sessionId={sessionId}
                  recordId={record.id}
                  field="result"
                />
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
              <Payload
                payload={record.compactionSummary}
                empty={t('trajectory.inspector.noContent')}
                sessionId={sessionId}
                recordId={record.id}
                field="summary"
              />
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

      {record.request !== null && (
        <div className="shrink-0 border-t border-border p-2">
          <Button
            size="sm"
            variant="outline"
            className="h-7 w-full justify-start text-[11px]"
            onClick={() => onSelectRequest(record.request!)}
          >
            <ArrowUpRight className="mr-1 size-3" />
            {t('trajectory.inspector.inspectRequest', { ordinal: record.request })}
          </Button>
        </div>
      )}
    </div>
  )
}
