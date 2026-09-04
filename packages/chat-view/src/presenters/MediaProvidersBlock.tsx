import { Image } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@superone/ui/lib/utils'
import {
  ExpandableToolRow,
  toolOutcomeLabel,
  withStreamingEllipsis,
} from './ToolRow'

interface ModelInfo {
  id: string
  label: string
}

interface ProviderInfo {
  id: string
  label: string
  provider?: string
  kind: string
  defaultModel?: string
  models?: ModelInfo[]
}

export interface MediaProvidersBlockPresenterProps {
  result: string | null
  isStreaming: boolean
  isError?: boolean
  isDenied?: boolean
  allowExpand?: boolean
}

export function MediaProvidersBlockPresenter({
  result,
  isStreaming,
  isError,
  isDenied,
  allowExpand = true,
}: MediaProvidersBlockPresenterProps) {
  const { t } = useTranslation()

  let providers: ProviderInfo[] = []
  if (!isStreaming && result) {
    try {
      const parsed = JSON.parse(result) as { providers?: ProviderInfo[] }
      if (Array.isArray(parsed.providers)) providers = parsed.providers
    } catch {}
  }
  const interrupted = isDenied || !!isError
  const tone = isDenied ? 'denied' : isError ? 'error' : 'default'
  const label = withStreamingEllipsis(toolOutcomeLabel({
    streaming: isStreaming,
    interrupted,
    streamingLabel: t('chat.toolBlock.listingMediaProviders'),
    actionLabel: t('chat.toolBlock.listMediaProviders'),
    doneLabel: t('chat.toolBlock.listedMediaProviders'),
  }), isStreaming)
  const canExpand = allowExpand && !isStreaming && !interrupted && providers.length > 0

  return (
    <ExpandableToolRow
      icon={<Image className="size-3 shrink-0 text-muted-foreground" />}
      label={label}
      summary={!isStreaming && !interrupted
        ? t('chat.toolBlock.mediaProvidersMatched', { count: providers.length })
        : undefined}
      streaming={isStreaming}
      tone={tone}
      expandable={canExpand}
    >
      <div className="flex flex-col gap-1.5">
          {providers.map((p) => (
            <div key={p.id} className="flex flex-col gap-0.5">
              <div className="flex items-center gap-1.5 text-xs">
                <span className="font-medium text-foreground">{p.provider ?? p.label}</span>
                {p.provider && (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{p.label}</span>
                )}
              </div>
              {p.models && p.models.length > 0 && (
                <div className="text-xs text-muted-foreground">
                  {p.models.map((m) => (
                    <span key={m.id} className={cn('mr-1.5', m.id === p.defaultModel && 'text-foreground')} title={m.id}>{m.label}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
      </div>
    </ExpandableToolRow>
  )
}
