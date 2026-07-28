import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@superone/ui/lib/utils'
import { ToolIcon } from './ToolIcon'

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

export function MediaProvidersBlock({ result, isStreaming }: { result: string | null; isStreaming: boolean }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)

  let providers: ProviderInfo[] = []
  if (!isStreaming && result) {
    try {
      const parsed = JSON.parse(result) as { providers?: ProviderInfo[] }
      if (Array.isArray(parsed.providers)) providers = parsed.providers
    } catch {}
  }
  const canExpand = !isStreaming && providers.length > 0

  return (
    <div className="tool-node my-0.5 rounded bg-muted/20">
      <button
        type="button"
        disabled={!canExpand}
        onClick={() => setExpanded((v) => !v)}
        className={cn('flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-xs', canExpand && 'cursor-pointer')}
      >
        <ToolIcon icon="image" className="size-3 shrink-0 text-muted-foreground" />
        <span className="shrink-0 font-medium text-foreground">
          {isStreaming ? `${t('chat.toolBlock.listingMediaProviders')}…` : t('chat.toolBlock.listedMediaProviders')}
        </span>
        {!isStreaming && (
          <span className="min-w-0 truncate text-muted-foreground">{t('chat.toolBlock.mediaProvidersMatched', { count: providers.length })}</span>
        )}
        {canExpand && (
          <ChevronRight className={cn('ml-auto size-3 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-90')} />
        )}
      </button>
      {expanded && (
        <div className="flex flex-col gap-1.5 border-t border-border/50 px-2 py-1.5">
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
      )}
    </div>
  )
}
