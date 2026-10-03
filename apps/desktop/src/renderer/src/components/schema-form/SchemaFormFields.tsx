import { useId, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Plus, X } from 'lucide-react'
import { Input } from '@superone/ui/components/ui/input'
import { Switch } from '@superone/ui/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@superone/ui/components/ui/select'
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
import { SchemaFormChoiceMark } from './SchemaFormChoiceMark'

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
    <span className="min-w-0 flex-1">
      <span className="block break-words text-xs text-foreground">{label}</span>
      {description && <span className="mt-0.5 block break-words text-xs text-muted-foreground">{description}</span>}
    </span>
  )
}

/** Shared row/tile chrome for single and multiple choice, so both read alike. */
function ChoiceList({
  options,
  multiple,
  selected,
  invalid,
  describedBy,
  label,
  onToggle,
}: {
  options: SchemaFormOption[]
  multiple: boolean
  selected: readonly string[]
  invalid: boolean
  describedBy?: string
  label: string
  onToggle: (value: string) => void
}) {
  // OpenAI spec: if any option has a thumbnail, every option renders as an image.
  const tiles = options.some((o) => o.thumbnail)
  return (
    <div
      role={multiple ? 'group' : 'radiogroup'}
      aria-label={label}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      className={tiles ? 'grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2' : 'flex flex-col gap-1'}
    >
      {options.map((option) => {
        const checked = selected.includes(option.value)
        const common = {
          role: multiple ? 'checkbox' : 'radio',
          'aria-checked': checked,
          onClick: () => onToggle(option.value),
        } as const
        if (tiles) {
          return (
            <button
              key={option.value}
              type="button"
              {...common}
              className={cn(
                'group relative flex cursor-pointer flex-col overflow-hidden rounded-md border text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
                checked ? 'border-primary ring-1 ring-primary' : 'border-border hover:border-foreground/30',
              )}
            >
              <SchemaFormThumbnail image={option.thumbnail} className="aspect-square w-full" />
              <span className="flex items-start gap-1.5 p-1.5">
                <OptionText label={option.label} description={option.description} />
              </span>
              {checked && (
                <span className="absolute top-1 right-1 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Check className="size-3" aria-hidden />
                </span>
              )}
            </button>
          )
        }
        return (
          <button
            key={option.value}
            type="button"
            {...common}
            className={cn(
              'flex cursor-pointer items-start gap-2 rounded-md border px-2 py-1.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
              checked ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent',
            )}
          >
            <SchemaFormChoiceMark multiple={multiple} checked={checked} className="mt-0.5" />
            <OptionText label={option.label} description={option.description} />
          </button>
        )
      })}
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

function TextField({ field, value, invalid, describedBy, onChange, id }: FieldProps<'text'> & { id: string }) {
  const { t } = useTranslation()
  const text = typeof value === 'string' ? value : ''
  const placeholder = field.format === 'date-time' ? t('chat.schemaForm.dateTimePlaceholder')
    : field.format === 'uri' ? t('chat.schemaForm.uriPlaceholder')
      : undefined
  return (
    <div className="flex flex-col gap-1.5">
      <Input
        id={id}
        type={(field.format && INPUT_TYPE[field.format]) ?? 'text'}
        value={text}
        placeholder={placeholder}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        maxLength={field.maxLength}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 text-xs"
      />
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
  const [draft, setDraft] = useState(() => (typeof value === 'number' ? String(value) : ''))
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

/** Rich or few options are laid out in full; a long plain list fits a menu. */
function selectInMenu(field: FieldOf<'select'>): boolean {
  return field.options.length > 4 && !field.options.some((o) => o.thumbnail || o.description)
}

function SelectField({ field, value, invalid, describedBy, onChange, id }: FieldProps<'select'> & { id: string }) {
  const { t } = useTranslation()
  const current = typeof value === 'string' ? value : ''
  if (!selectInMenu(field)) {
    return (
      <ChoiceList
        options={field.options}
        multiple={false}
        selected={current ? [current] : []}
        invalid={invalid}
        describedBy={describedBy}
        label={field.label}
        onToggle={(v) => onChange(v)}
      />
    )
  }
  return (
    <Select value={current} onValueChange={(v) => onChange(v)}>
      <SelectTrigger id={id} className="h-7 w-full text-xs" aria-invalid={invalid || undefined} aria-describedby={describedBy}>
        <SelectValue placeholder={t('chat.schemaForm.selectPlaceholder')} />
      </SelectTrigger>
      <SelectContent>
        {field.options.map((option) => (
          <SelectItem key={option.value} value={option.value} className="text-xs">{option.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
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

/** Every field of a parsed form, with the errors the caller chose to show. */
export function SchemaFormFields({ fields, values, errors, onChange, resources }: {
  fields: readonly SchemaFormField[]
  resources?: McpFormResourceActions
  values: SchemaFormValues
  errors: Record<string, SchemaFormError>
  onChange: (name: string, value: SchemaFormValue | undefined) => void
}) {
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
        if (field.kind === 'boolean') {
          return (
            <div key={field.name} className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-background/40 px-2 py-1.5">
                <label htmlFor={id} className="min-w-0 flex-1">
                  <span className="block text-xs font-medium break-words text-foreground">{field.label}</span>
                  {field.description && <span className="block text-xs break-words text-muted-foreground">{field.description}</span>}
                </label>
                <Switch id={id} checked={props.value === true} onCheckedChange={(checked) => props.onChange(checked)} aria-describedby={props.describedBy} />
              </div>
              {error && <p id={errorId} role="alert" className="text-xs text-destructive">{errorText(error)}</p>}
            </div>
          )
        }
        const control = field.kind === 'text' ? <TextField field={field} id={id} {...props} />
          : field.kind === 'number' ? <NumberField field={field} id={id} {...props} />
            : field.kind === 'select' ? <SelectField field={field} id={id} {...props} />
              : field.kind === 'multiselect' ? (
                <ChoiceList
                  options={field.options}
                  multiple
                  selected={asList(props.value)}
                  invalid={props.invalid}
                  describedBy={props.describedBy}
                  label={field.label}
                  onToggle={(v) => props.onChange(toggle(asList(props.value), v))}
                />
              )
                : field.kind === 'text-list' ? <TextListField field={field} id={id} {...props} />
                  : <SchemaFormResourceField field={field} resources={resources} {...props} />
        const labelled = field.kind === 'text' || field.kind === 'number' || field.kind === 'text-list'
          || (field.kind === 'select' && selectInMenu(field))
        return (
          <FieldFrame key={field.name} field={field} labelFor={labelled ? id : undefined} error={error ? errorText(error) : undefined} errorId={errorId}>
            {control}
          </FieldFrame>
        )
      })}
    </div>
  )
}
