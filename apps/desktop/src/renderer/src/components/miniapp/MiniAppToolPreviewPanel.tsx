import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@superone/ui/components/ui/badge'
import { buildToolRendererUrl } from '@superone/shared/miniapp-types'
import { buildMiniAppUrlHost } from '@superone/shared/miniapp-url'
import { miniAppPreviewTargetId } from '@superone/shared/miniapp-automation-target'
import { useToolUiPreviewStore, type ToolUiPreview, type ToolUiPreviewEvent } from '@/stores/miniapp-tool-preview'
import { ToolRendererFrame } from '@/components/chat/ToolRendererFrame'
import { StandaloneToolBlock } from '@/components/chat/StandaloneToolBlock'
import { pushBrowserConsole } from '@/components/browser/browser-host-api'
import { MiniAppIcon } from './MiniAppIcon'
import { miniAppTargetKey } from './miniapp-automation-targets'

type RecordEvent = (event: Omit<ToolUiPreviewEvent, 'at'>) => void

function PreviewFrame({ preview, onEvent }: { preview: ToolUiPreview; onEvent: RecordEvent }) {
  const callId = `preview-${preview.revision}`
  const automation = useMemo(() => ({
    targetId: miniAppPreviewTargetId(preview.appId),
    projectDir: preview.projectDir,
    kind: 'preview' as const,
    title: `${preview.toolLabel} (${preview.phase} preview)`,
  }), [preview.appId, preview.phase, preview.projectDir, preview.toolLabel])

  if (preview.phase === 'intercept') {
    const host = buildMiniAppUrlHost(preview.appId, preview.projectId)
    return (
      <ToolRendererFrame
        phase="intercept"
        state={{
          callId,
          appId: preview.appId,
          toolName: preview.tool,
          toolUseId: callId,
          templateUrl: buildToolRendererUrl('intercept', host, preview.templatePath, callId, preview.tool, preview.input),
          agentInput: preview.input,
          status: 'awaiting',
        }}
        onSubmit={(userInput) => onEvent({ kind: 'submit', payload: userInput })}
        onCancel={(reason) => onEvent({ kind: 'cancel', payload: reason })}
        automation={automation}
      />
    )
  }
  if (preview.phase === 'result') {
    return (
      <ToolRendererFrame
        phase="result"
        appId={preview.appId}
        callId={callId}
        toolName={preview.tool}
        templatePath={preview.templatePath}
        result={preview.result}
        onClose={() => onEvent({ kind: 'close' })}
        automation={automation}
      />
    )
  }
  return (
    <StandaloneToolBlock
      appId={preview.appId}
      toolUseId={callId}
      toolName={preview.tool}
      appName={preview.appName}
      toolReadableName={preview.toolLabel}
      args={preview.input}
      result={preview.result === undefined ? undefined : JSON.stringify(preview.result)}
      isStreaming={preview.running}
      templatePath={preview.templatePath}
      automation={automation}
    />
  )
}

export interface MiniAppToolPreviewViewProps {
  preview: ToolUiPreview | null
  onEvent: RecordEvent
}

/** Renders one development tool UI from fixture data, the way chat would show it. */
export function MiniAppToolPreviewView({ preview, onEvent }: MiniAppToolPreviewViewProps) {
  const { t } = useTranslation()
  if (!preview) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        {t('activity.toolPreview.empty')}
      </div>
    )
  }
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex min-w-0 items-center gap-2 border-b border-border px-3 py-2 text-xs">
        <MiniAppIcon appId={preview.appId} className="size-3.5 shrink-0" />
        <span className="truncate font-medium text-foreground">{preview.toolLabel}</span>
        <span className="truncate text-muted-foreground">{preview.appName}</span>
        <Badge variant="outline" className="ml-auto">{t(`activity.toolPreview.phase.${preview.phase}`)}</Badge>
        {preview.running && <Badge variant="secondary">{t('activity.toolPreview.running')}</Badge>}
        {preview.width !== undefined && (
          <span className="shrink-0 text-muted-foreground">{t('activity.toolPreview.width', { width: preview.width })}</span>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="mx-auto w-full" style={{ maxWidth: preview.width }}>
          <PreviewFrame key={preview.revision} preview={preview} onEvent={onEvent} />
        </div>
      </div>
      <div className="max-h-40 shrink-0 overflow-auto border-t border-border px-3 py-2 text-xs">
        <div className="font-medium text-foreground">{t('activity.toolPreview.eventsTitle')}</div>
        {preview.events.length === 0
          ? <p className="mt-1 text-muted-foreground">{t('activity.toolPreview.eventsHint')}</p>
          : (
              <ul className="mt-1 space-y-1">
                {preview.events.map((event, index) => (
                  <li key={index} className="flex min-w-0 gap-2">
                    <span className="shrink-0 font-medium text-foreground">{t(`activity.toolPreview.event.${event.kind}`)}</span>
                    {event.payload !== undefined && (
                      <code className="min-w-0 break-all font-mono text-muted-foreground">{JSON.stringify(event.payload)}</code>
                    )}
                  </li>
                ))}
              </ul>
            )}
      </div>
    </div>
  )
}

export function MiniAppToolPreviewPanel({ previewKey }: { previewKey: string }) {
  const preview = useToolUiPreviewStore((s) => s.previews[previewKey] ?? null)
  const record = useToolUiPreviewStore((s) => s.record)
  const onEvent = useCallback<RecordEvent>((event) => {
    if (!preview) return
    record(previewKey, event)
    // Also into the view's console, where the agent reads it with browser_snapshot.
    const payload = event.payload === undefined ? '' : ` ${JSON.stringify(event.payload)}`
    pushBrowserConsole(
      miniAppTargetKey(miniAppPreviewTargetId(preview.appId), preview.projectDir),
      'info',
      `[preview] ${event.kind}${payload}`,
    )
  }, [preview, previewKey, record])
  return <MiniAppToolPreviewView preview={preview} onEvent={onEvent} />
}
