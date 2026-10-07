import { useTranslation } from 'react-i18next'
import { useState } from 'react'
import type { PermissionRequest } from '@superone/shared/agent-types'
import { permissionDetailMessage, permissionDetailSections } from '@superone/shared/permission-details'
import { permissionPresentation } from '@superone/shared/permission-presentation'
import { ModDiff } from '@superone/chat-view/mod-ui/ModDiff'
import { EditDiff } from '../ToolBlock'

/** Scope is always visible before the decision; long values wrap and remain selectable. */
export function PermissionDetails({ request, summary, remembering = false }: { request: PermissionRequest; summary?: string; remembering?: boolean }) {
  const message = permissionDetailMessage(request)
  const presentation = permissionPresentation(request)
  if (remembering) return <RememberPermissionScope request={request} />
  if (!presentation && (!message || message === summary)) return null
  return (
    <div className="mb-2 min-w-0 space-y-2">
      {message && message !== summary ? <p className="whitespace-pre-wrap break-all text-xs text-muted-foreground">{message}</p> : null}
      {presentation ? <PermissionBody presentation={presentation} /> : null}
      {request.permissionDetails ? <PermissionTechnicalDetails request={request} /> : null}
    </div>
  )
}

function RememberPermissionScope({ request }: { request: PermissionRequest }) {
  const { t } = useTranslation()
  const details = request.permissionDetails
  return <div className="mb-2 space-y-2 text-xs">
    <p className="text-muted-foreground">{t('chat.permission.scoped.rememberHint')}</p>
    <pre className="max-h-48 select-text overflow-y-auto whitespace-pre-wrap break-all rounded bg-muted/50 px-2 py-1.5 font-mono text-foreground">{details?.save?.join('\n')}</pre>
    {details?.save?.includes('*') ? <p className="text-amber-600 dark:text-amber-400">{t('chat.permission.scoped.allResourcesHint', { action: details.action })}</p> : null}
  </div>
}

function PermissionTechnicalDetails({ request }: { request: PermissionRequest }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  return <details className="group min-w-0 text-xs" onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary className="cursor-pointer text-muted-foreground hover:text-foreground" onKeyDown={event => {
      if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
    }}>{t('chat.permission.scoped.technicalDetails')}</summary>
    {expanded ? <PermissionRawContext request={request} /> : null}
  </details>
}

function PermissionRawContext({ request }: { request: PermissionRequest }) {
  const { t } = useTranslation()
  const missingToolInput = request.permissionDetails?.source && request.permissionDetails.source.input === undefined
  return <div className="mt-2 max-h-64 space-y-2 overflow-y-auto">
    {permissionDetailSections(request).map(({ id, value }) => <section key={id} className={id === 'action' ? 'flex min-w-0 items-center gap-2' : 'min-w-0 space-y-1'}>
      <h3 className="text-xs font-medium text-muted-foreground">{t(`chat.permission.details.${id}`)}</h3>
      <pre className="min-w-0 select-text whitespace-pre-wrap break-all rounded bg-muted/50 px-2 py-1.5 font-mono text-xs text-foreground">{value}</pre>
    </section>)}
    {missingToolInput ? <p className="text-xs text-muted-foreground">{t('chat.permission.details.missingToolInput')}</p> : null}
  </div>
}

function PermissionBody({ presentation }: { presentation: NonNullable<ReturnType<typeof permissionPresentation>> }) {
  const { t } = useTranslation()
  const hasEdit = presentation.kind === 'edit' && presentation.editInput &&
    (presentation.editInput.old_string || presentation.editInput.new_string)
  return <div className="max-h-[min(60vh,32rem)] min-w-0 space-y-2 overflow-y-auto text-xs">
    {presentation.command ? <pre className="select-text whitespace-pre-wrap break-all rounded bg-muted/50 px-2 py-1.5 font-mono">{`$ ${presentation.command}`}</pre> : null}
    {presentation.directory ? <p className="break-all font-mono text-muted-foreground">{t('chat.permission.scoped.workingDirectory', { path: presentation.directory })}</p> : null}
    {!presentation.command && presentation.lines.length ? <div className="space-y-1">
      <p className="text-muted-foreground">{t('chat.permission.scoped.patterns')}</p>
      <pre className="select-text whitespace-pre-wrap break-all rounded bg-muted/50 px-2 py-1.5 font-mono">{presentation.lines.join('\n')}</pre>
    </div> : null}
    {presentation.diff ? <ModDiff source={presentation.diff} wrap="wrap" />
      : presentation.patch ? <pre className="select-text whitespace-pre-wrap break-all font-mono">{presentation.patch}</pre>
        : hasEdit ? <EditDiff params={presentation.editInput!} /> : null}
  </div>
}
