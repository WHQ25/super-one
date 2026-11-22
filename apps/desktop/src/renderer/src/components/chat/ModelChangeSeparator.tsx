import { useId } from 'react'
import type { ModelChangeMeta, ModelOption } from '@superone/shared/agent-types'
import { ArrowRight } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import { ModelGlyph } from '@/components/providers/ModelGlyph'
import { resolveModelDisplayName } from './ModelFallbackRow'

function ModelChip({ modelId, models }: { modelId: string; models: readonly ModelOption[] }) {
  const displayName = resolveModelDisplayName(modelId, models) ?? modelId
  return (
    <span className="inline-flex min-w-0 items-center gap-1 font-medium">
      <ModelGlyph modelId={modelId} modelName={displayName} size={12} />
      <span className="max-w-36 truncate @sm:max-w-44">{displayName}</span>
    </span>
  )
}

function OrnamentalWing({ mirror = false }: { mirror?: boolean }) {
  const gradId = useId()
  return (
    <div className={cn('flex min-w-0 flex-1 max-w-14 overflow-hidden @sm:max-w-20', mirror ? 'justify-start' : 'justify-end')} aria-hidden>
      <svg
        viewBox="0 0 160 28"
        fill="none"
        className={cn('h-3 w-14 shrink-0 text-muted-foreground/55 @sm:h-3.5 @sm:w-20', mirror && '-scale-x-100')}
      >
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0" />
            <stop offset="35%" stopColor="currentColor" stopOpacity="0.45" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0.9" />
          </linearGradient>
        </defs>
        <path
          d="M6 14 C32 14, 52 14, 76 14 C82 14, 86 9, 93 9 C98 9, 101 13, 97 16 C94 18, 90 15.5, 92.5 13"
          stroke={`url(#${gradId})`}
          strokeWidth="1.05"
          strokeLinecap="round"
        />
        <path
          d="M101 11 C106 5, 118 4, 124 10 C128 14, 125 21, 116 21 C109 21, 107 15.5, 112 14 C115.5 12.8, 118.5 15.5, 116 17.5"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinecap="round"
          opacity="0.85"
        />
        <path
          d="M124 9.5 C130 5.5, 140 7, 141 13.5 C142 18.5, 135 21, 130 18.5 C127 17, 128 13.5, 131.5 14"
          stroke="currentColor"
          strokeWidth="1.05"
          strokeLinecap="round"
          opacity="0.8"
        />
        <path
          d="M141 12.5 C147 10.5, 152 13.5, 149.5 17 C148 19, 144.5 18.5, 144 16.5"
          stroke="currentColor"
          strokeWidth="1"
          strokeLinecap="round"
          opacity="0.75"
        />
        <path
          d="M105 7 C110 3, 118 3, 122 6.5"
          stroke="currentColor"
          strokeWidth="0.85"
          strokeLinecap="round"
          opacity="0.5"
        />
        <path
          d="M111 23 C118 24.5, 125 23, 129 20"
          stroke="currentColor"
          strokeWidth="0.85"
          strokeLinecap="round"
          opacity="0.5"
        />
        <path
          d="M46 17.5 C64 17.5, 76 19, 90 19.5"
          stroke={`url(#${gradId})`}
          strokeWidth="0.85"
          strokeLinecap="round"
          opacity="0.55"
        />
      </svg>
    </div>
  )
}

export function ModelChangeSeparator({
  meta,
  models = [],
}: {
  meta: ModelChangeMeta
  models?: readonly ModelOption[]
}) {
  return (
    <div
      role="separator"
      data-model-change={`${meta.fromModel}->${meta.toModel}`}
      className="@container mt-2 mb-5 flex items-center justify-center gap-2 px-1 text-xs text-muted-foreground @sm:gap-2.5"
    >
      <OrnamentalWing />
      <div className="flex min-w-0 shrink-0 items-center gap-1.5 @sm:gap-2">
        <ModelChip modelId={meta.fromModel} models={models} />
        <ArrowRight className="size-2.5 shrink-0 text-muted-foreground/70 @sm:size-3" aria-hidden />
        <ModelChip modelId={meta.toModel} models={models} />
      </div>
      <OrnamentalWing mirror />
    </div>
  )
}
