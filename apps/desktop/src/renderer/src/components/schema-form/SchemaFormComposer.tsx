import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CircleSlash } from 'lucide-react'
import {
  initialSchemaFormValues,
  schemaFormForResourceHost,
  schemaFormContent,
  validateSchemaForm,
  type SchemaForm,
  type SchemaFormValue,
  type SchemaFormValues,
  type SchemaFormResource,
} from '@superone/shared/schema-form'
import type { McpFormResourceActions } from '@superone/shared/mcp-form-resources'
import { PermissionActionButton } from '../chat/PermissionActionBar'
import { SchemaFormFields } from './SchemaFormFields'

export interface SchemaFormComposerProps {
  form: SchemaForm
  /** Who asked, for the unsupported notice. */
  requester: string
  onSubmit: (content: Record<string, SchemaFormValue>) => void
  onDecline: () => void
  onCancel: () => void
  resources?: McpFormResourceActions
}

/**
 * A declarative form as one self-contained input surface: fields, validation and
 * its own submit/decline/cancel. Mount it with a `key` per request so a new form
 * starts from its own defaults.
 *
 * A form SuperOne cannot fully render is reported, never partially shown; the only
 * action left is to dismiss it, which tells the server the form was cancelled.
 */
export function SchemaFormComposer({ form: requestedForm, requester, onSubmit, onDecline, onCancel, resources }: SchemaFormComposerProps) {
  const { t } = useTranslation()
  const form = useMemo(() => schemaFormForResourceHost(requestedForm, Boolean(resources)), [requestedForm, resources])
  const [added, setAdded] = useState(() => new Map<string, SchemaFormResource[]>())
  const [picking, setPicking] = useState(0)
  const fields = useMemo(() => form.supported ? form.fields.map(field => field.kind === 'resource' && added.has(field.name)
    ? { ...field, options: [...field.options, ...added.get(field.name)!.filter(option => !field.options.some(original => original.uri === option.uri))] } : field) : [], [form, added])
  const [values, setValues] = useState<SchemaFormValues>(() => initialSchemaFormValues(fields))
  const resourceActions = useMemo<McpFormResourceActions | undefined>(() => resources && ({
    preview: resources.preview,
    pick: async field => {
      setPicking(count => count + 1)
      try {
        const chosen = await resources.pick(field)
        setAdded(current => new Map(current).set(field, [...(current.get(field) ?? []), ...chosen.filter(option => !(current.get(field) ?? []).some(original => original.uri === option.uri))]))
        return chosen
      } finally { setPicking(count => count - 1) }
    },
  }), [resources])
  // Errors appear per field once it is edited, and for every field after a submit attempt.
  const [touched, setTouched] = useState<ReadonlySet<string> | 'all'>(() => new Set())
  const errors = useMemo(() => validateSchemaForm(fields, values), [fields, values])
  const shownErrors = useMemo(
    () => Object.fromEntries(Object.entries(errors).filter(([name]) => touched === 'all' || touched.has(name))),
    [errors, touched],
  )

  if (!form.supported) {
    return (
      <div className="flex flex-col gap-2">
        <div role="alert" className="flex items-start gap-2 rounded-md border border-dashed border-border bg-muted/40 px-2.5 py-2">
          <CircleSlash className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0 text-xs">
            <p className="font-medium text-foreground">{t('chat.schemaForm.unsupportedTitle')}</p>
            <p className="mt-0.5 break-words text-muted-foreground">
              {t('chat.schemaForm.unsupportedBody', { requester })}
            </p>
            <p className="mt-1 font-mono text-[11px] break-words text-muted-foreground">
              {form.field ? `${form.field}: ${form.reason}` : form.reason}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 @xl:grid-cols-4">
          <PermissionActionButton tone="neutral" onClick={onCancel}>{t('chat.schemaForm.dismiss')}</PermissionActionButton>
        </div>
      </div>
    )
  }

  const setField = (name: string, value: SchemaFormValue | undefined) => {
    setValues((current) => ({ ...current, [name]: value }))
    setTouched((current) => (current === 'all' || current.has(name) ? current : new Set(current).add(name)))
  }
  const submit = () => {
    if (picking) return
    if (Object.keys(errors).length > 0) {
      setTouched('all')
      return
    }
    onSubmit(schemaFormContent(fields, values))
  }

  return (
    <div className="flex flex-col gap-3">
      {/* The transcript above stays visible however long the form is. */}
      <div className="-mx-1 max-h-[min(28rem,50vh)] overflow-y-auto px-1 py-0.5">
        <SchemaFormFields fields={fields} values={values} errors={shownErrors} onChange={setField} resources={resourceActions} />
      </div>
      <div className="grid grid-cols-2 gap-2 @xl:grid-cols-4">
        <PermissionActionButton tone="approve" disabled={picking > 0} onClick={submit}>{t('chat.schemaForm.submit')}</PermissionActionButton>
        <PermissionActionButton tone="reject" onClick={onDecline}>{t('chat.permission.decline')}</PermissionActionButton>
        <PermissionActionButton tone="neutral" onClick={onCancel}>{t('common.cancel')}</PermissionActionButton>
      </div>
    </div>
  )
}
