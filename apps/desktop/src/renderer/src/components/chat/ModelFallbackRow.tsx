import type { ModelFallbackMeta, ModelOption } from '@superone/shared/agent-types'
import { Ban, Shuffle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { stripOneM } from '@/lib/model-id'

/**
 * Triggers we have prose for. The CLI ships new reasons on the wire ahead of any
 * schema, so an unknown trigger renders raw rather than as a missing-key path.
 */
const KNOWN_TRIGGERS = new Set([
  'overloaded',
  'server_error',
  'model_not_found',
  'permission_denied',
  'model_blocked',
  'last_resort',
  'refusal',
])

/** `claude-opus-5[1m]` → `opus-5`. Last resort when the catalog has no entry. */
export function shortModelName(model?: string): string | null {
  if (!model) return null
  return model.replace(/^(claude|anthropic|us\.anthropic)[./-]/, '').replace(/\[1m\]$/, '')
}

/**
 * Catalog display name for a raw model id from the wire.
 *
 * The harness announces ids (`claude-opus-5`), never labels, so the name has to
 * come from whichever harness catalog is loaded. `[1m]` ids never appear in a
 * catalog, so match on the base id too.
 */
export function resolveModelDisplayName(
  model: string | undefined,
  models: readonly ModelOption[],
): string | null {
  if (!model) return null
  const base = stripOneM(model)
  const found = models.find((m) => m.id === model) ?? models.find((m) => stripOneM(m.id) === base)
  return found?.name?.trim() || shortModelName(model)
}

/**
 * Compact "the harness swapped models" transcript row.
 *
 * Styled as a transcript notice rather than a bottom-of-stream tinted card: which
 * model produced a reply is still true after the turn ends, so it stays where it
 * happened instead of being cleared on idle.
 */
export function ModelFallbackRow({
  meta,
  models = [],
}: {
  meta: ModelFallbackMeta
  models?: readonly ModelOption[]
}) {
  const { t } = useTranslation()
  const declined = meta.outcome === 'declined'
  const to = resolveModelDisplayName(meta.toModel, models)
  const from = resolveModelDisplayName(meta.fromModel, models)
  const reason = KNOWN_TRIGGERS.has(meta.trigger)
    ? t(`chat.modelFallback.reason.${meta.trigger}`)
    : meta.trigger

  // A `local` swap covered one subagent / side-question only — the session model
  // is unchanged, so it must not read as "the session switched".
  const label = declined
    ? (from ? t('chat.modelFallback.declined', { model: from }) : t('chat.modelFallback.declinedNoModel'))
    : to
      ? t(meta.scope === 'local' ? 'chat.modelFallback.localOnly' : 'chat.modelFallback.switchedTo', { model: to })
      : t('chat.modelFallback.switched')
  const detail = declined ? t('chat.modelFallback.noFallback') : reason
  const Icon = declined ? Ban : Shuffle

  return (
    <div
      className="my-0.5 flex w-0 min-w-full justify-end"
      data-model-fallback={meta.trigger}
      data-model-fallback-outcome={declined ? 'declined' : 'swapped'}
      role="note"
    >
      <div className="flex max-w-[90%] min-w-0 items-center gap-1.5 px-0.5 text-xs text-muted-foreground">
        <Icon className="size-3 shrink-0 text-warning" aria-hidden />
        <span className="shrink-0">{label}</span>
        <span className="truncate text-muted-foreground/70">· {detail}</span>
        {meta.refusalCategory && (
          <span className="shrink-0 text-muted-foreground/70">· {meta.refusalCategory}</span>
        )}
      </div>
    </div>
  )
}
