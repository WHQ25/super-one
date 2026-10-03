import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, CircleSlash } from 'lucide-react'
import { Button } from '@superone/ui/components/ui/button'
import { Kbd } from '@superone/ui/components/ui/kbd'
import { cn } from '@superone/ui/lib/utils'
import {
  initialSchemaFormValues,
  schemaFormForResourceHost,
  schemaFormContent,
  schemaFormStepAdvancesOnPick,
  schemaFormSteps,
  validateSchemaForm,
  type SchemaForm,
  type SchemaFormValue,
  type SchemaFormValues,
  type SchemaFormResource,
} from '@superone/shared/schema-form'
import type { McpFormResourceActions } from '@superone/shared/mcp-form-resources'
import { PermissionActionButton } from '../chat/PermissionActionBar'
import { canAutofocusInChatRoot, isFocusInChat, useChatRootRef } from '../chat/is-focus-in-chat'
import { numberedChoiceCount, pickNumberedChoice, SchemaFormFields } from './SchemaFormFields'
import { NUMBERED_PICK_WAIT_MS, readNumberedPick, typeNumberedPick } from './numbered-pick'

export interface SchemaFormComposerProps {
  form: SchemaForm
  /** Who asked, for the unsupported notice. */
  requester: string
  onSubmit: (content: Record<string, SchemaFormValue>) => void
  onDecline: () => void
  onCancel: () => void
  resources?: McpFormResourceActions
  /** False while the card is collapsed: answers are kept, keys go elsewhere. */
  active?: boolean
}

function isEditable(element: Element | null): element is HTMLElement {
  return element instanceof HTMLElement && (element.isContentEditable || element.matches('input, textarea, select'))
}

/**
 * A declarative form as one self-contained input surface, asked one step at a
 * time like AskUserQuestion: each choice on its own step, typed fields together
 * (`schemaFormSteps`). Mount it with a `key` per request so a new form starts
 * from its own defaults.
 *
 * Keys, scoped to this chat pane: digits pick a numbered option (two-digit
 * numbers wait briefly for their second digit, see `numbered-pick`), Enter moves
 * on (submitting on the last step), Esc leaves a field or cancels the form.
 *
 * A form SuperOne cannot fully render is reported, never partially shown; the only
 * action left is to dismiss it, which tells the server the form was cancelled.
 */
export function SchemaFormComposer({ form: requestedForm, requester, onSubmit, onDecline, onCancel, resources, active = true }: SchemaFormComposerProps) {
  const { t } = useTranslation()
  const chatRootRef = useChatRootRef()
  const rootRef = useRef<HTMLDivElement>(null)
  const form = useMemo(() => schemaFormForResourceHost(requestedForm, Boolean(resources)), [requestedForm, resources])
  const [added, setAdded] = useState(() => new Map<string, SchemaFormResource[]>())
  const [picking, setPicking] = useState(0)
  const fields = useMemo(() => form.supported ? form.fields.map(field => field.kind === 'resource' && added.has(field.name)
    ? { ...field, options: [...field.options, ...added.get(field.name)!.filter(option => !field.options.some(original => original.uri === option.uri))] } : field) : [], [form, added])
  const steps = useMemo(() => schemaFormSteps(fields), [fields])
  const [stepIndex, setStepIndex] = useState(0)
  const step = steps[stepIndex] ?? []
  const lastStep = stepIndex >= steps.length - 1
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
  // Errors appear per field once it is edited, and for a whole step when moving on fails.
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set())
  const errors = useMemo(() => validateSchemaForm(fields, values), [fields, values])
  const shownErrors = useMemo(
    () => Object.fromEntries(Object.entries(errors).filter(([name]) => touched.has(name))),
    [errors, touched],
  )

  // A step asking one pickable field takes its option numbers from the keyboard.
  const pickField = step.length === 1 && numberedChoiceCount(step[0]!) > 0 ? step[0]! : undefined
  const choiceCount = pickField ? numberedChoiceCount(pickField) : 0
  const [typed, setTyped] = useState('')
  const typedTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const showChoice = (index: number) => rootRef.current?.querySelector(`[data-choice="${index}"]`)?.scrollIntoView?.({ block: 'nearest' })
  useEffect(() => { clearTimeout(typedTimer.current); setTyped('') }, [stepIndex])
  useEffect(() => () => clearTimeout(typedTimer.current), [])

  const reveal = (names: readonly string[]) => setTouched(current => new Set([...current, ...names]))
  const setField = (name: string, value: SchemaFormValue | undefined) => {
    setValues(current => ({ ...current, [name]: value }))
    reveal([name])
  }
  // Picking the one answer a step asks for moves on, except on the last step.
  const choose = (name: string, value: SchemaFormValue | undefined) => {
    setField(name, value)
    if (!lastStep && schemaFormStepAdvancesOnPick(step)
      && !Object.keys(validateSchemaForm(step, { ...values, [name]: value })).length) setStepIndex(stepIndex + 1)
  }
  const next = () => {
    if (picking) return
    const invalid = step.filter(field => errors[field.name])
    if (invalid.length) return reveal(invalid.map(field => field.name))
    if (!lastStep) return setStepIndex(stepIndex + 1)
    onSubmit(schemaFormContent(fields, values))
  }

  // Land on each step ready for keys: its first input, else the step itself.
  useEffect(() => {
    if (!active || !form.supported || !canAutofocusInChatRoot(chatRootRef?.current)) return
    const root = rootRef.current
    const target = root?.querySelector<HTMLElement>('[data-step] input:not([type=hidden]), [data-step] textarea') ?? root
    target?.focus({ preventScroll: true })
  }, [active, form.supported, stepIndex, chatRootRef])

  const typeDigits = (digits: string) => {
    clearTimeout(typedTimer.current)
    setTyped(digits)
    if (!digits) return
    typedTimer.current = setTimeout(() => commitTyped.current(), NUMBERED_PICK_WAIT_MS)
    const read = readNumberedPick(digits, choiceCount)
    if (read.kind !== 'none') showChoice(read.index)
  }
  const pickNumber = (index: number) => {
    typeDigits('')
    const value = pickField && pickNumberedChoice(pickField, values[pickField.name], index)
    if (value === undefined) return
    choose(pickField!.name, value)
    showChoice(index)
  }
  // The pause, Enter or the next key settles a number still waiting for a digit.
  const commitTyped = useRef(() => {})
  commitTyped.current = () => {
    const read = readNumberedPick(typed, choiceCount)
    if (read.kind === 'none') typeDigits('')
    else pickNumber(read.index)
  }

  const onKey = useRef<(event: KeyboardEvent) => void>(() => {})
  onKey.current = (event) => {
    if (!active || event.defaultPrevented || event.isComposing) return
    const focused = document.activeElement
    if (!isFocusInChat(focused, chatRootRef?.current)) return
    const editing = isEditable(focused)
    // The chat composer and other inputs in this pane keep their own keys.
    if (editing && !rootRef.current?.contains(focused)) return
    if (typed) {
      if (event.key === 'Escape') { event.preventDefault(); typeDigits(''); return }
      if (event.key === 'Backspace') { event.preventDefault(); typeDigits(typed.slice(0, -1)); return }
      if (event.key === 'Enter') { event.preventDefault(); commitTyped.current(); return }
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      // Leaving a field keeps focus in the form, so the next Esc or digit still lands here.
      if (editing) rootRef.current?.focus()
      else onCancel()
      return
    }
    if (!form.supported) return
    if (event.key === 'Enter' && !event.shiftKey && !event.altKey) {
      // A focused action button (Back, Decline, a picker) does its own thing; options move on.
      if (focused instanceof HTMLButtonElement && !focused.matches('[role=radio], [role=checkbox]')) return
      event.preventDefault()
      next()
      return
    }
    if (!editing && choiceCount && /^\d$/.test(event.key)) {
      event.preventDefault()
      const { digits, read } = typeNumberedPick(typed, event.key, choiceCount)
      if (read.kind === 'pick') pickNumber(read.index)
      else typeDigits(read.kind === 'wait' ? digits : '')
    }
  }
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey.current(event)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  const cancelHint = (
    <button type="button" aria-label={t('common.cancel')} onClick={onCancel} className="inline-flex cursor-pointer items-center gap-0.5 hover:text-foreground">
      <Kbd>esc</Kbd>{t('chat.schemaForm.hintCancel')}
    </button>
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

  return (
    <div ref={rootRef} tabIndex={-1} className="flex flex-col gap-3 outline-none focus-visible:shadow-none">
      {steps.length > 1 && (
        <div className="flex items-center gap-2">
          <div className="flex flex-1 gap-1" aria-hidden>
            {steps.map((_, index) => (
              <span key={index} className={cn('h-0.5 flex-1 rounded-full', index <= stepIndex ? 'bg-primary' : 'bg-border')} />
            ))}
          </div>
          <span className="text-[11px] text-muted-foreground tabular-nums" aria-label={t('chat.schemaForm.progress', { current: stepIndex + 1, total: steps.length })}>
            {stepIndex + 1}/{steps.length}
          </span>
        </div>
      )}
      {/* The transcript above stays visible however long a step is. */}
      <div key={stepIndex} data-step className="-mx-1 max-h-[min(28rem,50vh)] overflow-y-auto px-1 py-0.5">
        <SchemaFormFields fields={step} values={values} errors={shownErrors} onChange={choose} resources={resourceActions} typed={pickField ? typed : undefined} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {stepIndex > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setStepIndex(stepIndex - 1)} className="h-7 cursor-pointer gap-0.5 px-1.5 text-xs text-muted-foreground">
            <ChevronLeft className="size-3.5" aria-hidden />{t('chat.schemaForm.back')}
          </Button>
        )}
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-xs text-muted-foreground">
          {pickField && <><Kbd className="tabular-nums">{typed ? `${typed}_` : 'num'}</Kbd>{t('chat.schemaForm.hintSelect')}<span className="opacity-40">·</span></>}
          {cancelHint}
        </span>
        <PermissionActionButton tone="neutral" onClick={onDecline}>{t('chat.permission.decline')}</PermissionActionButton>
        <PermissionActionButton tone="primary" disabled={picking > 0} onClick={next} kbd="↵">
          {lastStep ? t('chat.schemaForm.submit') : t('chat.schemaForm.next')}
        </PermissionActionButton>
      </div>
    </div>
  )
}
