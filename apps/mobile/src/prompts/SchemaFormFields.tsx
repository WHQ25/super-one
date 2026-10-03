import { useState, type ReactNode } from 'react'
import { Image, Pressable, StyleSheet, View, type KeyboardTypeOptions } from 'react-native'
import { Check, FileText, ImageIcon, Plus, Square, SquareCheck, X } from 'lucide-react-native'
import { formatBytes } from '@superone/shared/format-bytes'
import type {
  SchemaFormError,
  SchemaFormField,
  SchemaFormImage,
  SchemaFormOption,
  SchemaFormResource,
  SchemaFormValue,
  SchemaFormValues,
} from '@superone/shared/schema-form'
import { Text } from '../ui/text'
import { useMobileTheme } from '../theme/context'
import { useMobileLocale } from '../i18n/context'
import { PromptInput, PromptPill } from './PromptControls'
import { usePromptStyles } from './styles'

type FieldOf<K extends SchemaFormField['kind']> = Extract<SchemaFormField, { kind: K }>

const FORMAT_COPY: Record<string, string> = {
  email: 'Enter an email address',
  uri: 'Enter a URI, such as https://example.com',
  date: 'Enter a date as YYYY-MM-DD',
  'date-time': 'Enter a date and time with a time zone',
}

const ERROR_COPY: Record<SchemaFormError['code'], string> = {
  required: 'Required',
  type: 'Enter a valid value',
  minLength: 'Use at least {limit} characters',
  maxLength: 'Use at most {limit} characters',
  pattern: "Doesn't match the expected format",
  format: 'Enter a valid value',
  minimum: 'Must be at least {limit}',
  maximum: 'Must be at most {limit}',
  integer: 'Must be a whole number',
  minItems: 'Choose at least {limit}',
  maxItems: 'Choose at most {limit}',
  unique: 'Each value can appear only once',
  option: 'Choose one of the listed options',
}

function toggle(list: readonly string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
}

function asList(value: SchemaFormValue | undefined): string[] {
  return Array.isArray(value) ? value : []
}

/** Server image already limited to https/data by the shared parser; a fallback glyph otherwise. */
function Thumbnail({ image, size = THUMBNAIL_SIZE }: { image?: SchemaFormImage; size?: number }) {
  const { tokens: { colors, radius } } = useMobileTheme()
  const [failed, setFailed] = useState(false)
  const box = { width: size, height: size }
  if (!image || failed) {
    return <View style={[box, { backgroundColor: colors.muted, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' }]}>
      <ImageIcon size={size / 2} color={colors.mutedForeground} />
    </View>
  }
  return <Image source={{ uri: image.src }} onError={() => setFailed(true)} resizeMode="cover" style={[box, { borderRadius: radius.sm, backgroundColor: colors.muted }]} />
}

/**
 * One borderless choice, as on the desktop: an optional image, the text, and the
 * selection at the end — a check on the chosen single option, a checkbox per
 * row for multiple choice.
 */
function ChoiceRow({ testID, label, meta, media, selected, multi, onPress }: { testID: string; label: string; meta?: string; media?: ReactNode; selected: boolean; multi: boolean; onPress: () => void }) {
  const styles = usePromptStyles()
  const { tokens: { colors } } = useMobileTheme()
  const Mark = multi ? selected ? SquareCheck : Square : Check
  return <Pressable testID={testID} accessibilityRole={multi ? 'checkbox' : 'radio'} accessibilityState={{ checked: selected }} accessibilityLabel={label}
    onPress={onPress} style={({ pressed }) => [styles.choice, local.row, selected && styles.selectedChoice, pressed && styles.pressed]}>
    {media}
    <View style={styles.grow}>
      <Text style={styles.body} numberOfLines={media ? 2 : undefined}>{label}</Text>
      {meta ? <Text style={styles.meta} numberOfLines={media ? 2 : undefined}>{meta}</Text> : null}
    </View>
    <Mark size={18} color={selected ? colors.primary : colors.mutedForeground} style={!multi && !selected ? local.hidden : undefined} />
  </Pressable>
}

function Choices({ options, selected, multi, onToggle }: { options: SchemaFormOption[]; selected: readonly string[]; multi: boolean; onToggle: (value: string) => void }) {
  // OpenAI spec: when any option has a thumbnail, every option renders with an image.
  const images = options.some((o) => o.thumbnail)
  return <View style={local.list}>
    {options.map((option) => <ChoiceRow key={option.value} testID={`prompt-option-${option.label}`} label={option.label} meta={option.description}
      media={images ? <Thumbnail image={option.thumbnail} /> : undefined} multi={multi} selected={selected.includes(option.value)} onPress={() => onToggle(option.value)} />)}
  </View>
}

function Suggestions({ options, isActive, onPick }: { options: SchemaFormOption[]; isActive: (value: string) => boolean; onPick: (value: string) => void }) {
  const styles = usePromptStyles()
  return <View style={styles.wrap}>
    {options.map((option) => <PromptPill key={option.value} multi label={option.label} selected={isActive(option.value)} onPress={() => onPick(option.value)} />)}
  </View>
}

const KEYBOARD: Partial<Record<string, KeyboardTypeOptions>> = { email: 'email-address', uri: 'url' }

function TextField({ field, value, onChange }: { field: FieldOf<'text'>; value: SchemaFormValue | undefined; onChange: (value: SchemaFormValue | undefined) => void }) {
  const styles = usePromptStyles()
  const text = typeof value === 'string' ? value : ''
  const placeholder = field.format === 'date' ? 'YYYY-MM-DD' : field.format === 'date-time' ? '2026-01-31T09:00:00Z' : undefined
  return <View style={styles.tight}>
    <PromptInput testID={`prompt-field-${field.name}`} accessibilityLabel={field.label} value={text} placeholder={placeholder}
      keyboardType={field.format ? KEYBOARD[field.format] : undefined} autoCapitalize={field.format ? 'none' : 'sentences'} autoCorrect={!field.format}
      maxLength={field.maxLength} onChangeText={(next) => onChange(next)} />
    {field.suggestions ? <Suggestions options={field.suggestions} isActive={(v) => v === text} onPick={(v) => onChange(v)} /> : null}
  </View>
}

function NumberField({ field, value, onChange }: { field: FieldOf<'number'>; value: SchemaFormValue | undefined; onChange: (value: SchemaFormValue | undefined) => void }) {
  // Keep the typed text: "1." or "-" are drafts that are not numbers yet. A step
  // remounts its fields, so an unfinished draft comes back from the value.
  const [draft, setDraft] = useState(() => (value === undefined || typeof value === 'object' ? '' : String(value)))
  return <PromptInput testID={`prompt-field-${field.name}`} accessibilityLabel={field.label} value={draft}
    keyboardType={field.integer ? 'number-pad' : 'decimal-pad'}
    onChangeText={(raw) => {
      setDraft(raw)
      const n = raw.trim() === '' ? undefined : Number(raw)
      onChange(n === undefined ? undefined : Number.isFinite(n) ? n : raw)
    }} />
}

function TextListField({ field, value, onChange }: { field: FieldOf<'text-list'>; value: SchemaFormValue | undefined; onChange: (value: SchemaFormValue | undefined) => void }) {
  const styles = usePromptStyles()
  const { tokens: { colors } } = useMobileTheme()
  const { t } = useMobileLocale()
  const items = asList(value)
  const [draft, setDraft] = useState('')
  const labels = new Map(field.suggestions?.map((o) => [o.value, o.label]))
  const add = () => {
    const next = draft.trim()
    if (!next) return
    onChange([...items, next])
    setDraft('')
  }
  return <View style={styles.tight}>
    {items.length ? <View style={styles.wrap}>
      {items.map((item, index) => <Pressable key={`${item}-${index}`} accessibilityRole="button" accessibilityLabel={`${t('Remove')} ${labels.get(item) ?? item}`}
        onPress={() => onChange(items.filter((_, i) => i !== index))} style={({ pressed }) => [styles.pill, local.chip, pressed && styles.pressed]}>
        <Text style={styles.pillText} numberOfLines={1}>{labels.get(item) ?? item}</Text>
        <X size={14} color={colors.mutedForeground} />
      </Pressable>)}
    </View> : null}
    <View style={styles.row}>
      <View style={styles.grow}>
        <PromptInput testID={`prompt-field-${field.name}`} accessibilityLabel={field.label} value={draft} placeholder="Add a value"
          maxLength={field.item.maxLength} returnKeyType="done" blurOnSubmit={false} onChangeText={setDraft} onSubmitEditing={add} />
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={t('Add')} accessibilityState={{ disabled: !draft.trim() }} disabled={!draft.trim()} onPress={add}
        style={({ pressed }) => [styles.pill, !draft.trim() && styles.disabled, pressed && styles.pressed]}>
        <Plus size={16} color={colors.foreground} />
      </Pressable>
    </View>
    {field.suggestions ? <Suggestions options={field.suggestions} isActive={(v) => items.includes(v)} onPick={(v) => onChange(toggle(items, v))} /> : null}
  </View>
}

function ResourceRow({ resource, selected, multi, onPress }: { resource: SchemaFormResource; selected: boolean; multi: boolean; onPress: () => void }) {
  const { tokens: { colors, radius } } = useMobileTheme()
  const meta = resource.description ?? [resource.title ? resource.name : undefined, resource.size !== undefined ? formatBytes(resource.size) : undefined].filter(Boolean).join(' · ')
  return <ChoiceRow testID={`prompt-option-${resource.uri}`} label={resource.title ?? resource.name} meta={meta || undefined} multi={multi} selected={selected} onPress={onPress}
    media={resource.thumbnail ? <Thumbnail image={resource.thumbnail} />
      : <View style={[local.fileIcon, { backgroundColor: colors.muted, borderRadius: radius.sm }]}><FileText size={18} color={colors.mutedForeground} /></View>} />
}

function ResourceField({ field, value, onChange }: { field: FieldOf<'resource'>; value: SchemaFormValue | undefined; onChange: (value: SchemaFormValue | undefined) => void }) {
  const styles = usePromptStyles()
  const multi = field.selection !== 'single'
  const selected = multi ? asList(value) : typeof value === 'string' ? [value] : []
  const { t } = useMobileLocale()
  if (!field.options.length) return <Text style={styles.meta}>{t('Nothing to choose from.')}</Text>
  return <View style={local.list}>
    {field.options.map((resource) => <ResourceRow key={resource.uri} resource={resource} multi={multi} selected={selected.includes(resource.uri)}
      onPress={() => onChange(multi ? toggle(selected, resource.uri) : resource.uri)} />)}
  </View>
}

/** The phone renderer of a parsed schema form; `errors` are the ones the caller chose to show. */
export function SchemaFormFields({ fields, values, errors, onChange }: {
  fields: readonly SchemaFormField[]
  values: SchemaFormValues
  errors: Record<string, SchemaFormError>
  onChange: (name: string, value: SchemaFormValue | undefined) => void
}) {
  const styles = usePromptStyles()
  const { tokens: { colors } } = useMobileTheme()
  const { t } = useMobileLocale()
  const errorText = (error: SchemaFormError) => error.code === 'format' && FORMAT_COPY[String(error.limit)]
    ? t(FORMAT_COPY[String(error.limit)]!)
    : t(ERROR_COPY[error.code]).replace('{limit}', String(error.limit ?? ''))
  return <View style={styles.stack}>
    {fields.map((field) => {
      const value = values[field.name]
      const set = (next: SchemaFormValue | undefined) => onChange(field.name, next)
      const error = errors[field.name]
      const label = `${field.label}${field.required ? ' *' : ''}`
      return <View key={field.name} style={styles.tight}>
        <Text style={styles.body}>{label}</Text>
        {field.description ? <Text style={styles.meta}>{field.description}</Text> : null}
        {field.kind === 'boolean' ? <Choices options={[{ value: 'true', label: t('Yes') }, { value: 'false', label: t('No') }]} multi={false}
          selected={typeof value === 'boolean' ? [String(value)] : []} onToggle={(v) => set(v === 'true')} />
          : field.kind === 'text' ? <TextField field={field} value={value} onChange={set} />
          : field.kind === 'number' ? <NumberField field={field} value={value} onChange={set} />
            : field.kind === 'select' ? <Choices options={field.options} multi={false} selected={typeof value === 'string' ? [value] : []} onToggle={set} />
              : field.kind === 'multiselect' ? <Choices options={field.options} multi selected={asList(value)} onToggle={(v) => set(toggle(asList(value), v))} />
                : field.kind === 'text-list' ? <TextListField field={field} value={value} onChange={set} />
                  : <ResourceField field={field} value={value} onChange={set} />}
        {error ? <Text style={[styles.meta, { color: colors.destructive }]}>{errorText(error)}</Text> : null}
      </View>
    })}
  </View>
}

const THUMBNAIL_SIZE = 40

const local = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%' },
  list: { gap: 2 },
  row: { alignItems: 'center', borderWidth: 0 },
  hidden: { opacity: 0 },
  fileIcon: { width: THUMBNAIL_SIZE, height: THUMBNAIL_SIZE, alignItems: 'center', justifyContent: 'center' },
})
