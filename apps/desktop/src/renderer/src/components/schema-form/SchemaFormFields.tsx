import { useId, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, X } from 'lucide-react'
import { Input } from '@superone/ui/components/ui/input'
import { AutoResizeTextarea } from '@superone/ui/components/ui/auto-resize-textarea'
import { cn } from '@superone/ui/lib/utils'
import type {
  SchemaFormError,
  SchemaFormField,
  SchemaFormOption,
  SchemaFormValue,
  SchemaFormValues,
} from '@superone/shared/schema-form'

import type { McpFormResourceActions } from '@superone/shared/mcp-form-resources'
import { SchemaFormResourceField } from './SchemaFormResourceField'
import { SchemaFormThumbnail } from './SchemaFormThumbnail'
import { SchemaFormChoiceRow, type ChoiceNumbers } from './SchemaFormChoiceRow'

type FieldOf<K extends SchemaFormField['kind']> = Extract<SchemaFormField, { kind: K }>

interface FieldProps<K extends SchemaFormField['kind']> {
  field: FieldOf<K>
  value: SchemaFormValue | undefined
  invalid: boolean
  describedBy?: string
  onChange: (value: SchemaFormValue | undefined) => void
}

export function useSchemaFormErrorText(): (error: SchemaFormError) => string {
  const { t } = useTranslation()
  return (error) => {
    const limit = error.limit
    switch (error.code) {
      case 'required': return t('chat.schemaForm.errors.required')
      case 'type': return t('chat.schemaForm.errors.type')
      case 'minLength': return t('chat.schemaForm.errors.minLength', { limit })
      case 'maxLength': return t('chat.schemaForm.errors.maxLength', { limit })
      case 'pattern': return t('chat.schemaForm.errors.pattern')
      case 'format':
        return limit === 'email' ? t('chat.schemaForm.errors.formatEmail')
          : limit === 'uri' ? t('chat.schemaForm.errors.formatUri')
            : limit === 'date' ? t('chat.schemaForm.errors.formatDate')
              : t('chat.schemaForm.errors.formatDateTime')
      case 'minimum': return t('chat.schemaForm.errors.minimum', { limit })
      case 'maximum': return t('chat.schemaForm.errors.maximum', { limit })
      case 'integer': return t('chat.schemaForm.errors.integer')
      case 'minItems': return t('chat.schemaForm.errors.minItems', { limit })
      case 'maxItems': return t('chat.schemaForm.errors.maxItems', { limit })
      case 'unique': return t('chat.schemaForm.errors.unique')
      case 'option': return t('chat.schemaForm.errors.option')
    }
  }
}

function OptionText({ label, description }: { label: string; description?: string }) {
  return (
    <>
      <span className="block break-words text-xs text-foreground">{label}</span>
      {description && <span className="mt-0.5 block break-words text-xs text-muted-foreground">{description}</span>}
    </>
  )
}

/** Single and multiple choice as one numbered list, so both read alike. */
function ChoiceList({
  options,
  multiple,
  selected,
  invalid,
  describedBy,
  label,
  numbers,
  onToggle,
}: {
  options: SchemaFormOption[]
  multiple: boolean
  selected: readonly string[]
  invalid: boolean
  describedBy?: string
  label: string
  numbers?: ChoiceNumbers
  onToggle: (value: string) => void
}) {
  // OpenAI spec: if any option has a thumbnail, every option renders with an image.
  const images = options.some((o) => o.thumbnail)
  return (
    <div
      role={multiple ? 'group' : 'radiogroup'}
      aria-label={label}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      className="flex flex-col gap-0.5"
    >
      {options.map((option, index) => (
        <SchemaFormChoiceRow
          key={option.value}
          index={index}
          numbers={numbers}
          multiple={multiple}
          checked={selected.includes(option.value)}
          onSelect={() => onToggle(option.value)}
          media={images && <SchemaFormThumbnail image={option.thumbnail} className="size-8 shrink-0 rounded" />}
        >
          <OptionText label={option.label} description={option.description} />
        </SchemaFormChoiceRow>
      ))}
    </div>
  )
}

function toggle(list: readonly string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
}

function asList(value: SchemaFormValue | undefined): string[] {
  return Array.isArray(value) ? value : []
}

const INPUT_TYPE: Record<string, string> = { email: 'email', date: 'date' }

function TextField({ field, value, invalid, describedBy, onChange, id, onSubmit }: FieldProps<'text'> & { id: string; onSubmit?: () => void }) {
  const { t } = useTranslation()
  const text = typeof value === 'string' ? value : ''
  const placeholder = field.format === 'date-time' ? t('chat.schemaForm.dateTimePlaceholder')
    : field.format === 'uri' ? t('chat.schemaForm.uriPlaceholder')
      : undefined
  return (
    <div className="flex flex-col gap-1.5">
      {!field.format && !field.pattern && (field.maxLength === undefined || field.maxLength > 80) ? (
        <AutoResizeTextarea
          id={id}
          value={text}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          maxLength={field.maxLength}
          onValueChange={onChange}
          onSubmit={onSubmit}
          className="min-h-7 px-3 py-1 text-xs leading-[18px]"
        />
      ) : <Input
        id={id}
        type={(field.format && INPUT_TYPE[field.format]) ?? 'text'}
        value={text}
        placeholder={placeholder}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        maxLength={field.maxLength}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 text-xs"
      />}
      {field.suggestions && (
        <Suggestions options={field.suggestions} isActive={(v) => v === text} onPick={(v) => onChange(v)} />
      )}
    </div>
  )
}

function Suggestions({ options, isActive, onPick }: { options: SchemaFormOption[]; isActive: (value: string) => boolean; onPick: (value: string) => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-wrap items-center gap-1" aria-label={t('chat.schemaForm.suggestions')}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          title={option.description}
          aria-pressed={isActive(option.value)}
          onClick={() => onPick(option.value)}
          className={cn(
            'inline-flex max-w-full cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
            isActive(option.value) ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground',
          )}
        >
          {option.thumbnail && <SchemaFormThumbnail image={option.thumbnail} className="size-3.5 rounded-full" />}
          <span className="truncate">{option.label}</span>
        </button>
      ))}
    </div>
  )
}

function NumberField({ field, value, invalid, describedBy, onChange, id }: FieldProps<'number'> & { id: string }) {
  // Keep the typed text: "1." or "-" are valid drafts that are not numbers yet.
  // A step remounts its fields, so an unfinished draft comes back from the value.
  const [draft, setDraft] = useState(() => (value === undefined || typeof value === 'object' ? '' : String(value)))
  return (
    <Input
      id={id}
      type="number"
      inputMode={field.integer ? 'numeric' : 'decimal'}
      step={field.integer ? 1 : 'any'}
      min={field.minimum}
      max={field.maximum}
      value={draft}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      onChange={(e) => {
        const raw = e.target.value
        setDraft(raw)
        const n = raw.trim() === '' ? undefined : Number(raw)
        onChange(n === undefined ? undefined : Number.isFinite(n) ? n : raw)
      }}
      className="h-7 text-xs"
    />
  )
}

function SelectField({ field, value, invalid, describedBy, onChange, numbers }: FieldProps<'select'> & { numbers?: ChoiceNumbers }) {
  const current = typeof value === 'string' ? value : ''
  return (
    <ChoiceList
      options={field.options}
      multiple={false}
      selected={current ? [current] : []}
      invalid={invalid}
      describedBy={describedBy}
      label={field.label}
      numbers={numbers}
      onToggle={(v) => onChange(v)}
    />
  )
}

function TextListField({ field, value, invalid, describedBy, onChange, id }: FieldProps<'text-list'> & { id: string }) {
  const { t } = useTranslation()
  const items = asList(value)
  const [draft, setDraft] = useState('')
  const labels = new Map(field.suggestions?.map((o) => [o.value, o.label]))
  const add = () => {
    const next = draft.trim()
    if (!next) return
    onChange([...items, next])
    setDraft('')
  }
  return (
    <div className="flex flex-col gap-1.5">
      {items.length > 0 && (
        <ul className="flex flex-wrap gap-1">
          {items.map((item, index) => (
            <li key={`${item}-${index}`} className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-muted/50 py-0.5 pr-1 pl-2 text-xs">
              <span className="truncate">{labels.get(item) ?? item}</span>
              <button
                type="button"
                aria-label={t('chat.schemaForm.remove', { name: labels.get(item) ?? item })}
                onClick={() => onChange(items.filter((_, i) => i !== index))}
                className="cursor-pointer rounded-full p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="size-3" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-1">
        <Input
          id={id}
          value={draft}
          placeholder={t('chat.schemaForm.addPlaceholder')}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          maxLength={field.item.maxLength}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
            e.preventDefault()
            add()
          }}
          className="h-7 flex-1 text-xs"
        />
        <button
          type="button"
          onClick={add}
          disabled={!draft.trim()}
          aria-label={t('chat.schemaForm.add')}
          className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus className="size-3.5" aria-hidden />
        </button>
      </div>
      {field.suggestions && (
        <Suggestions
          options={field.suggestions}
          isActive={(v) => items.includes(v)}
          onPick={(v) => onChange(toggle(items, v))}
        />
      )}
    </div>
  )
}

function FieldFrame({ field, labelFor, error, errorId, children }: {
  field: SchemaFormField
  labelFor?: string
  error?: string
  errorId: string
  children: ReactNode
}) {
  const label = (
    <span className="text-xs font-medium break-words text-foreground">
      {field.label}
      {field.required && <span className="ml-1 text-destructive" aria-hidden>*</span>}
    </span>
  )
  return (
    <div className="flex flex-col gap-1">
      {labelFor ? <label htmlFor={labelFor}>{label}</label> : label}
      {field.description && <p className="text-xs break-words text-muted-foreground">{field.description}</p>}
      {children}
      {error && <p id={errorId} role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

/** How many options of a field its shortcut numbers reach; zero for a field not answered by picking. */
export function numberedChoiceCount(field: SchemaFormField): number {
  if (field.kind === 'boolean') return 2
  if (field.kind === 'select' || field.kind === 'multiselect') return field.options.length
  if (field.kind === 'resource' && field.selection !== 'implicit') return field.options.length
  return 0
}

/** The answer after picking option `index` by its number; undefined when the field lists no such option. */
export function pickNumberedChoice(field: SchemaFormField, current: SchemaFormValue | undefined, index: number): SchemaFormValue | undefined {
  if (index < 0 || index >= numberedChoiceCount(field)) return undefined
  if (field.kind === 'boolean') return index === 0
  if (field.kind === 'select') return field.options[index]!.value
  if (field.kind === 'multiselect') return toggle(asList(current), field.options[index]!.value)
  if (field.kind === 'resource') {
    const uri = field.options[index]!.uri
    return field.selection === 'single' ? uri : toggle(asList(current), uri)
  }
  return undefined
}

/** Every field of a parsed form, with the errors the caller chose to show. */
export function SchemaFormFields({ fields, values, errors, onChange, onSubmit, resources, typed }: {
  fields: readonly SchemaFormField[]
  resources?: McpFormResourceActions
  values: SchemaFormValues
  errors: Record<string, SchemaFormError>
  onChange: (name: string, value: SchemaFormValue | undefined) => void
  onSubmit?: () => void
  /** Digits typed toward an option number; set only when the composer handles number keys. */
  typed?: string
}) {
  const { t } = useTranslation()
  const idBase = useId()
  const errorText = useSchemaFormErrorText()
  return (
    <div className="flex flex-col gap-3">
      {fields.map((field) => {
        const id = `${idBase}-${field.name}`
        const errorId = `${id}-error`
        const error = errors[field.name]
        const props = {
          value: values[field.name],
          invalid: Boolean(error),
          describedBy: error ? errorId : undefined,
          onChange: (value: SchemaFormValue | undefined) => onChange(field.name, value),
        }
        const count = numberedChoiceCount(field)
        const numbers = typed !== undefined && count > 0 ? { count, typed } : undefined
        const control = field.kind === 'boolean' ? (
          <ChoiceList
            options={[{ value: 'true', label: t('chat.schemaForm.yes') }, { value: 'false', label: t('chat.schemaForm.no') }]}
            multiple={false}
            selected={typeof props.value === 'boolean' ? [String(props.value)] : []}
            invalid={props.invalid}
            describedBy={props.describedBy}
            label={field.label}
            numbers={numbers}
            onToggle={(v) => props.onChange(v === 'true')}
          />
        )
          : field.kind === 'text' ? <TextField field={field} id={id} onSubmit={onSubmit} {...props} />
          : field.kind === 'number' ? <NumberField field={field} id={id} {...props} />
            : field.kind === 'select' ? <SelectField field={field} numbers={numbers} {...props} />
              : field.kind === 'multiselect' ? (
                <ChoiceList
                  options={field.options}
                  multiple
                  selected={asList(props.value)}
                  invalid={props.invalid}
                  describedBy={props.describedBy}
                  label={field.label}
                  numbers={numbers}
                  onToggle={(v) => props.onChange(toggle(asList(props.value), v))}
                />
              )
                : field.kind === 'text-list' ? <TextListField field={field} id={id} {...props} />
                  : <SchemaFormResourceField field={field} resources={resources} numbers={numbers} {...props} />
        const labelled = field.kind === 'text' || field.kind === 'number' || field.kind === 'text-list'
        return (
          <FieldFrame key={field.name} field={field} labelFor={labelled ? id : undefined} error={error ? errorText(error) : undefined} errorId={errorId}>
            {control}
          </FieldFrame>
        )
      })}
    </div>
  )
}
