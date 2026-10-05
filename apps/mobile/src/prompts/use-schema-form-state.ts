import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { initialSchemaFormValues, schemaFormContent, schemaFormStepAdvancesOnPick, schemaFormSteps, validateSchemaForm, type SchemaFormField, type SchemaFormValue, type SchemaFormValues } from '@superone/shared/schema-form'

export interface SchemaFormDraft {
  values: SchemaFormValues
  stepIndex: number
  touched: ReadonlySet<string>
}

/** Native sheets and composer forms share validation, stepping and answer formatting. */
export function useSchemaFormState(fields: readonly SchemaFormField[], requestId: string, draft?: SchemaFormDraft, onDraftChange?: (draft: SchemaFormDraft) => void) {
  const steps = useMemo(() => schemaFormSteps(fields), [fields])
  const [stepIndex, setStepIndex] = useState(() => draft?.stepIndex ?? 0)
  const [values, setValues] = useState<SchemaFormValues>(() => draft?.values ?? initialSchemaFormValues(fields))
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => draft?.touched ?? new Set())
  useEffect(() => {
    setValues(draft?.values ?? initialSchemaFormValues(fields))
    setStepIndex(draft?.stepIndex ?? 0)
    setTouched(draft?.touched ?? new Set())
    // A request owns its initial state; later draft writes must not reset it.
  }, [requestId])
  useLayoutEffect(() => { onDraftChange?.({ values, stepIndex, touched }) }, [values, stepIndex, touched, onDraftChange])
  const step = steps[stepIndex] ?? []
  const lastStep = stepIndex >= steps.length - 1
  const errors = validateSchemaForm(step, values)
  const shownErrors = Object.fromEntries(Object.entries(errors).filter(([name]) => touched.has(name)))
  const setField = (name: string, value: SchemaFormValue | undefined) => {
    setValues(current => ({ ...current, [name]: value }))
    setTouched(current => new Set(current).add(name))
    if (!lastStep && schemaFormStepAdvancesOnPick(step)
      && !Object.keys(validateSchemaForm(step, { ...values, [name]: value })).length) setStepIndex(stepIndex + 1)
  }
  const next = (submit: (values: Record<string, SchemaFormValue>) => void) => {
    if (Object.keys(errors).length) {
      setTouched(current => new Set([...current, ...Object.keys(errors)]))
      return
    }
    if (!lastStep) { setStepIndex(stepIndex + 1); return }
    const invalid = validateSchemaForm(fields, values)
    if (Object.keys(invalid).length) {
      setTouched(current => new Set([...current, ...Object.keys(invalid)]))
      setStepIndex(Math.max(0, steps.findIndex(fields => fields.some(field => invalid[field.name]))))
      return
    }
    submit(schemaFormContent(fields, values))
  }
  return { steps, stepIndex, setStepIndex, step, lastStep, values, errors, shownErrors, setField, next }
}
