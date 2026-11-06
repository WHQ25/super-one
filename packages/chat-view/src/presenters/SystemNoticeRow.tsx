import { Info, Lightbulb, TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { SystemNoticeMeta } from '@superone/shared/agent-types'

/** Provider text stays literal; notices never borrow the running reply's state. */
export function SystemNoticeRow({ meta, text }: { meta: SystemNoticeMeta; text: string }) {
  const { t, i18n } = useTranslation()
  if (meta.kind === 'storage') {
    const lost = Array.isArray(meta.details?.lost) ? meta.details.lost.filter((item): item is string => typeof item === 'string') : []
    const targets = lost.map(item => item === 'transcript' ? t('chat.systemNotice.transcript') : item === 'global_config' ? t('chat.systemNotice.config') : item)
    const reason = meta.code === 'ENOSPC' ? t('chat.systemNotice.diskFull') : meta.code === 'EDQUOT' ? t('chat.systemNotice.quotaFull') : t('chat.systemNotice.writeFailed')
    text = t('chat.systemNotice.storageFailure', { targets: targets.length ? new Intl.ListFormat(i18n.language, { type: 'conjunction' }).format(targets) : t('chat.systemNotice.data'), reason })
      + (lost.includes('transcript') ? ` ${t('chat.systemNotice.resumeWarning')}` : '')
  }
  const Icon = meta.level === 'warning' ? TriangleAlert : meta.level === 'suggestion' ? Lightbulb : Info
  return (
    <div role="note" data-system-notice={meta.level} className="my-1 min-w-0 space-y-1 px-0.5 text-xs leading-relaxed text-muted-foreground">
      <div className="flex min-w-0 items-start gap-1.5">
        <Icon aria-hidden className={`mt-0.5 size-3 shrink-0 ${meta.level === 'warning' ? 'text-warning' : ''}`} />
        <p className="min-w-0 whitespace-pre-wrap break-words">
          <span className="font-medium">{meta.source}</span>{': '}{text}
        </p>
      </div>
      {(meta.code || meta.details) && <details className="ml-4.5">
        <summary className="cursor-pointer">{t('chat.systemNotice.details')}</summary>
        <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono">{JSON.stringify({ ...(meta.code ? { code: meta.code } : {}), ...meta.details }, null, 2)}</pre>
      </details>}
    </div>
  )
}
