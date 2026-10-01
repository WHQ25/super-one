import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CircleSlash } from 'lucide-react'
import {
  initialSchemaFormValues,
  schemaFormContent,
  validateSchemaForm,
  type SchemaForm,
  type SchemaFormValue,
  type SchemaFormValues,
} from '@superone/shared/schema-form'
import { PermissionActionButton } from '../chat/PermissionActionBar'
import { SchemaFormFields } from './SchemaFormFields'

export interface SchemaFormComposerProps {
  form: SchemaForm
  /** Who asked, for the unsupported notice. */
  requester: string
  onSubmit: (content: Record<string, SchemaFormValue>, always: boolean) => void
  onDecline: () => void
  onCancel: () => void
  /** Offer "Submit and always allow" (Codex `_meta.persist: always`). */
  allowAlways?: boolean
}

/**
 * A declarative form as one self-contained input surface: fields, validation and
 * its own submit/decline/cancel. Mount it with a `key` per request so a new form
 * starts from its own defaults.
 *
 * A form SuperOne cannot fully render is reported, never partially shown; the only
 * action left is to dismiss it, which tells the server the form was cancelled.
 */
export function SchemaFormComposer({ form, requester, onSubmit, onDecline, onCancel, allowAlways }: SchemaFormComposerProps) {
  const { t } = useTranslation()
  const fields = form.supported ? form.fields : []
  const [values, setValues] = useState<SchemaFormValues>(() => initialSchemaFormValues(fields))
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
  const submit = (always: boolean) => {
    if (Object.keys(errors).length > 0) {
      setTouched('all')
      return
    }
    onSubmit(schemaFormContent(fields, values), always)
  }

  return (
    <div className="flex flex-col gap-3">
      {/* The transcript above stays visible however long the form is. */}
      <div className="-mx-1 max-h-[min(28rem,50vh)] overflow-y-auto px-1 py-0.5">
        <SchemaFormFields fields={fields} values={values} errors={shownErrors} onChange={setField} />
      </div>
      <div className="grid grid-cols-2 gap-2 @xl:grid-cols-4">
        <PermissionActionButton tone="approve" onClick={() => submit(false)}>{t('chat.schemaForm.submit')}</PermissionActionButton>
        {allowAlways && (
          <PermissionActionButton tone="primary" onClick={() => submit(true)}>{t('chat.schemaForm.submitAlways')}</PermissionActionButton>
        )}
        <PermissionActionButton tone="reject" onClick={onDecline}>{t('chat.permission.decline')}</PermissionActionButton>
        <PermissionActionButton tone="neutral" onClick={onCancel}>{t('common.cancel')}</PermissionActionButton>
      </div>
    </div>
  )
}
