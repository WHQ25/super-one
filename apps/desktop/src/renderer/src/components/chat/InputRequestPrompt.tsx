import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PermissionRequest } from '@superone/shared/agent-types'
import type { InputRequestMeta } from '@superone/shared/input-request'
import type { SchemaForm, SchemaFormValue } from '@superone/shared/schema-form'
import type { McpFormResourceActions } from '@superone/shared/mcp-form-resources'
import { isInputRequest } from '@superone/shared/input-request-presentation'
import { useScopedSessionActions } from '@/stores/chat'
import { SchemaFormComposer, type SchemaFormComposerDraft } from '../schema-form/SchemaFormComposer'
import { useMcpFormResources } from '../schema-form/use-mcp-form-resources'
import { useInputRequestDraft } from './input-request-drafts'

export interface InputRequestFormProps {
  meta: InputRequestMeta
  form: SchemaForm
  resources?: McpFormResourceActions
  active?: boolean
  error?: string
  draft?: SchemaFormComposerDraft
  onDraftChange?: (draft: SchemaFormComposerDraft) => void
  onSubmit: (values: Record<string, SchemaFormValue>) => Promise<boolean>
  onCancel: () => Promise<boolean>
}

/** Production form body, also used by stories without a session or host side effects. */
export function InputRequestForm({ meta, form, onSubmit, onCancel, error: hostError, ...props }: InputRequestFormProps) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)
  const run = async (action: () => Promise<boolean>) => {
    if (inFlight.current || props.active === false) return
    inFlight.current = true
    setBusy(true)
    setError(null)
    try {
      if (!await action()) setError(t('chat.inputRequest.submitFailed'))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('chat.inputRequest.submitFailed'))
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }
  return (
    <section className="@container flex min-w-0 flex-col gap-3 p-3" aria-label={meta.title}>
      <div className="min-w-0">
        <p className="mb-1 break-words text-[11px] text-muted-foreground">{meta.origin.kind === 'miniapp'
          ? meta.origin.appName ?? meta.origin.appId
          : t(meta.origin.kind === 'agent' ? 'chat.inputRequest.originAgent' : 'chat.inputRequest.originWidget')}</p>
        <h3 className="break-words text-sm font-medium">{meta.title}</h3>
        {meta.description && <p className="mt-1 whitespace-pre-wrap break-words text-xs text-muted-foreground">{meta.description}</p>}
      </div>
      <SchemaFormComposer
        {...props}
        form={form}
        requester={meta.origin.kind === 'miniapp' ? meta.origin.appName ?? meta.origin.appId : meta.title}
        submitLabel={meta.submitLabel}
        disabled={busy}
        onSubmit={values => { void run(() => onSubmit(values)) }}
        onCancel={() => { void run(onCancel) }}
      />
      {(error || hostError) && <p role="alert" className="break-words text-xs text-destructive">{error || hostError}</p>}
    </section>
  )
}

export function InputRequestPrompt({ request, active = true }: { request: PermissionRequest; active?: boolean }) {
  const { respondToPermission, sendInputRequest } = useScopedSessionActions()
  const resources = useMcpFormResources(request.requestId, true)
  const draft = useInputRequestDraft(request.requestId)
  if (!isInputRequest(request) || !request.schemaForm) return null
  return (
    <InputRequestForm
      key={request.requestId}
      meta={request.inputRequest}
      form={request.schemaForm}
      resources={resources}
      active={active}
      {...draft}
      onSubmit={values => request.inputRequest.output === 'agent'
        ? sendInputRequest(request.requestId, values)
        : respondToPermission(request.requestId, true, false, undefined, undefined, undefined, values)}
      onCancel={() => respondToPermission(request.requestId, false, false, undefined, undefined, 'cancel')}
    />
  )
}
