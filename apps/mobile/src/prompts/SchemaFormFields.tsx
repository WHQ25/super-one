import { useState } from 'react'
import { Image, Pressable, StyleSheet, Switch, View, type KeyboardTypeOptions } from 'react-native'
import { CheckCircle2, Circle, FileText, ImageIcon, Plus, Square, SquareCheck, X } from 'lucide-react-native'
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
import { PromptChoice, PromptInput, PromptPill } from './PromptControls'
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
function Thumbnail({ image, size }: { image?: SchemaFormImage; size?: number }) {
  const { tokens: { colors, radius } } = useMobileTheme()
  const [failed, setFailed] = useState(false)
  const box = size ? { width: size, height: size } : { width: '100%' as const, aspectRatio: 1 }
  if (!image || failed) {
    return <View style={[box, { backgroundColor: colors.muted, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' }]}>
      <ImageIcon size={size ? size / 2 : 24} color={colors.mutedForeground} />
    </View>
  }
  return <Image source={{ uri: image.src }} onError={() => setFailed(true)} resizeMode="cover" style={[box, { borderRadius: radius.sm, backgroundColor: colors.muted }]} />
}

/** OpenAI spec: when any option has a thumbnail, every option renders as an image. */
function ThumbnailGrid({ options, selected, multi, onToggle }: { options: SchemaFormOption[]; selected: readonly string[]; multi: boolean; onToggle: (value: string) => void }) {
  const styles = usePromptStyles()
  const { tokens: { colors } } = useMobileTheme()
  return <View style={local.grid}>
    {options.map((option) => {
      const checked = selected.includes(option.value)
      return <Pressable key={option.value} testID={`prompt-option-${option.label}`} accessibilityRole={multi ? 'checkbox' : 'radio'} accessibilityState={{ checked }} accessibilityLabel={option.label}
        onPress={() => onToggle(option.value)} style={({ pressed }) => [styles.choice, local.tile, checked && styles.selectedChoice, pressed && styles.pressed]}>
        <Thumbnail image={option.thumbnail} />
        <Text style={styles.body} numberOfLines={3}>{option.label}</Text>
        {option.description ? <Text style={styles.meta} numberOfLines={3}>{option.description}</Text> : null}
        {checked ? <View style={[local.badge, { backgroundColor: colors.primary }]}><CheckCircle2 size={14} color={colors.primaryForeground} /></View> : null}
      </Pressable>
    })}
  </View>
}

function Choices({ options, selected, multi, onToggle }: { options: SchemaFormOption[]; selected: readonly string[]; multi: boolean; onToggle: (value: string) => void }) {
  const styles = usePromptStyles()
  if (options.some((o) => o.thumbnail)) return <ThumbnailGrid options={options} selected={selected} multi={multi} onToggle={onToggle} />
  return <View style={styles.tight}>
    {options.map((option) => <PromptChoice key={option.value} multi={multi} label={option.label} description={option.description} selected={selected.includes(option.value)} onPress={() => onToggle(option.value)} />)}
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
  // Keep the typed text: "1." or "-" are drafts that are not numbers yet.
  const [draft, setDraft] = useState(() => (typeof value === 'number' ? String(value) : ''))
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
  const styles = usePromptStyles()
  const { tokens: { colors, radius } } = useMobileTheme()
  const Icon = multi ? selected ? SquareCheck : Square : selected ? CheckCircle2 : Circle
  const meta = resource.description ?? [resource.title ? resource.name : undefined, resource.size !== undefined ? formatBytes(resource.size) : undefined].filter(Boolean).join(' · ')
  return <Pressable testID={`prompt-option-${resource.uri}`} accessibilityRole={multi ? 'checkbox' : 'radio'} accessibilityState={{ checked: selected }} accessibilityLabel={resource.title ?? resource.name}
    onPress={onPress} style={({ pressed }) => [styles.choice, local.resource, selected && styles.selectedChoice, pressed && styles.pressed]}>
    <Icon size={16} color={selected ? colors.primary : colors.mutedForeground} />
    {resource.thumbnail ? <Thumbnail image={resource.thumbnail} size={36} />
      : <View style={[local.fileIcon, { backgroundColor: colors.muted, borderRadius: radius.sm }]}><FileText size={18} color={colors.mutedForeground} /></View>}
    <View style={styles.grow}>
      <Text style={styles.body} numberOfLines={1}>{resource.title ?? resource.name}</Text>
      {meta ? <Text style={styles.meta} numberOfLines={1}>{meta}</Text> : null}
    </View>
  </Pressable>
}

function ResourceField({ field, value, onChange }: { field: FieldOf<'resource'>; value: SchemaFormValue | undefined; onChange: (value: SchemaFormValue | undefined) => void }) {
  const styles = usePromptStyles()
  const multi = field.selection !== 'single'
  const selected = multi ? asList(value) : typeof value === 'string' ? [value] : []
  const { t } = useMobileLocale()
  if (!field.options.length) return <Text style={styles.meta}>{t('Nothing to choose from.')}</Text>
  return <View style={styles.tight}>
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
      if (field.kind === 'boolean') {
        return <View key={field.name} style={styles.tight}>
          <View style={styles.row}>
            <View style={styles.grow}>
              <Text style={styles.body}>{field.label}</Text>
              {field.description ? <Text style={styles.meta}>{field.description}</Text> : null}
            </View>
            <Switch testID={`prompt-field-${field.name}`} accessibilityLabel={field.label} value={value === true} trackColor={{ true: colors.primary }} onValueChange={set} />
          </View>
          {error ? <Text style={[styles.meta, { color: colors.destructive }]}>{errorText(error)}</Text> : null}
        </View>
      }
      return <View key={field.name} style={styles.tight}>
        <Text style={styles.body}>{label}</Text>
        {field.description ? <Text style={styles.meta}>{field.description}</Text> : null}
        {field.kind === 'text' ? <TextField field={field} value={value} onChange={set} />
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

const local = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 8 },
  tile: { flexDirection: 'column', alignItems: 'stretch', width: '48.5%', paddingHorizontal: 8, paddingVertical: 8, gap: 6 },
  badge: { position: 'absolute', top: 12, right: 12, borderRadius: 999, padding: 2 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%' },
  resource: { alignItems: 'center' },
  fileIcon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
})
