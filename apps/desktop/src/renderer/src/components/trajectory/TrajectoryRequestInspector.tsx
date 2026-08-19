import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CornerDownRight, X } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@superone/ui/components/ui/tabs'
import { Button } from '@superone/ui/components/ui/button'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import type { TrajectoryProjection, TrajectoryRequest } from '@superone/shared/trajectory-types'
import { Facts, Payload } from './TrajectoryPayloadView'
import { formatClock, formatDuration, formatTokens } from './trajectory-format'

const TABS = ['options', 'prompt', 'tools', 'metrics'] as const

export interface TrajectoryRequestInspectorProps {
  projection: TrajectoryProjection
  request: TrajectoryRequest
  sessionId: string
  onClose: () => void
  /** Bring the record this call produced into view. */
  onReveal: (recordId: string) => void
}

/**
 * One model call, inspected as itself.
 *
 * The call's identity is the prompt and options in force when it was
 * dispatched, which is a different question from what any single record it
 * produced contains — and the one that explains a surprising answer.
 */
export function TrajectoryRequestInspector({
  projection,
  request,
  sessionId,
  onClose,
  onReveal,
}: TrajectoryRequestInspectorProps) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<string>(TABS[0])
  const header = request.header === null ? null : projection.headers[request.header] ?? null

  const produced = useMemo(
    () => projection.records.find((record) =>
      record.request === request.ordinal && (record.kind === 'message' || record.kind === 'compacted')),
    [projection.records, request.ordinal],
  )

  const config = header?.config ?? null
  const defaults = header?.adapterDefaults ?? null
  /** Mark a field the adapter filled in, so it is not read as a caller choice. */
  const label = (value: string, adapted: boolean | undefined): string =>
    adapted === true ? `${value} ${t('trajectory.inspector.adapterDefault')}` : value

  return (
    <div className="flex h-full flex-col border-l border-border">
      <div className="flex shrink-0 items-center gap-2 px-3 py-1.5">
        <span className="font-mono text-[11px] text-muted-foreground">
          {t('trajectory.request', { ordinal: request.ordinal })}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground/70">
          {request.purpose}
        </span>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground/60">
          {formatClock(request.startedAt)} · {formatDuration(request.durationMs)}
        </span>
        <IconButton size="xs" variant="nested" tooltip={t('common.close')} onClick={onClose}>
          <X />
        </IconButton>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col gap-0">
        <div className="shrink-0 px-2 pb-1">
          <TabsList className="w-full">
          {TABS.map((id) => (
            <TabsTrigger key={id} value={id} className="text-[11px]">
              {t(`trajectory.inspector.${id}`)}
            </TabsTrigger>
          ))}
          </TabsList>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          <TabsContent value="options">
            {config === null
              ? <div className="p-3 text-[11px] text-muted-foreground">{t('trajectory.inspector.noHeader')}</div>
              : (
                <Facts rows={[
                  [t('trajectory.inspector.provider'), config.provider],
                  [t('trajectory.inspector.model'), config.model],
                  [t('trajectory.inspector.effort'), label(config.reasoningEffort ?? '—', defaults?.reasoningEffort)],
                  [t('trajectory.inspector.temperature'), config.temperature?.toString() ?? '—'],
                  [t('trajectory.inspector.maxTokens'), label(formatTokens(config.maxTokens ?? null), defaults?.maxTokens)],
                  [t('trajectory.inspector.stop'), config.stop?.join(', ') ?? '—'],
                ]}
                />
              )}
          </TabsContent>

          <TabsContent value="prompt">
            <Payload
              payload={header?.system ?? null}
              empty={t('trajectory.inspector.noPrompt')}
              sessionId={sessionId}
              recordId={header === null ? null : `header:${header.index}`}
              field="system"
            />
          </TabsContent>

          <TabsContent value="tools">
            {header === null || header.tools.length === 0
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

          <TabsContent value="metrics">
            <Facts rows={[
              [t('trajectory.inspector.route'), request.route === null
                ? '—'
                : `${request.route.provider} / ${request.route.model}`],
              [t('trajectory.inspector.contextWindow'), formatTokens(request.route?.contextWindow ?? null)],
              [t('trajectory.inspector.ttft'), formatDuration(request.ttftMs)],
              [t('trajectory.inspector.duration'), formatDuration(request.durationMs)],
              [t('trajectory.inspector.input'), formatTokens(request.usage?.input ?? null)],
              [t('trajectory.inspector.output'), formatTokens(request.usage?.output ?? null)],
              [t('trajectory.inspector.cacheRead'), formatTokens(request.usage?.cacheRead ?? null)],
              [t('trajectory.inspector.cacheWrite'), formatTokens(request.usage?.cacheWrite ?? null)],
              [t('trajectory.inspector.reasoning'), formatTokens(request.usage?.reasoning ?? null)],
            ]}
            />
          </TabsContent>
        </div>
      </Tabs>

      {produced !== undefined && (
        <div className="shrink-0 border-t border-border p-2">
          <Button
            size="sm"
            variant="outline"
            className="h-7 w-full justify-start text-[11px]"
            onClick={() => onReveal(produced.id)}
          >
            <CornerDownRight className="mr-1 size-3" />
            {t('trajectory.inspector.jumpToResult', { index: produced.index })}
          </Button>
        </div>
      )}
    </div>
  )
}
