import { useEffect, useRef, useState } from 'react'
import { Pressable, Switch, View } from 'react-native'
import { Text } from '../ui/text'
import type { ConfigConfirmField } from '@superone/shared/agent-types'
import { useMobileTheme } from '../theme/context'
import { PromptInput, PromptPill } from './PromptControls'
import { usePromptStyles } from './styles'
import { useMobileLocale } from '../i18n/context'

export function SelectField({ label, value, options, onChange }: { label: string; value: string; options: { id: string; label: string }[]; onChange: (value: string) => void }) {
  const styles = usePromptStyles()
  const { t } = useMobileLocale()
  const [open, setOpen] = useState(false)
  const selected = options.find((option) => option.id === value)
  return <View style={styles.tight}><Text style={styles.label}>{t(label)}</Text>
    <Pressable testID={`prompt-select-${label}`} accessibilityRole="button" accessibilityLabel={t(label)} accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} style={[styles.input, styles.row]}><Text style={[styles.body, styles.grow]}>{selected?.label || value || t('Default')}</Text><Text style={styles.meta}>{open ? '⌃' : '⌄'}</Text></Pressable>
    {open ? <View style={styles.wrap}>{options.map((option) => <PromptPill key={option.id} label={option.label} selected={value === option.id} onPress={() => { onChange(option.id); setOpen(false) }} />)}</View> : null}
  </View>
}

export function EditableField({ field, value, onChange, onValidity }: { field: Pick<ConfigConfirmField, 'label' | 'type' | 'enumValues' | 'secret' | 'min' | 'max' | 'clearable' | 'note'>; value: unknown; onChange: (value: unknown) => void; onValidity?: (valid: boolean) => void }) {
  const styles = usePromptStyles()
  const { tokens } = useMobileTheme()
  const { t } = useMobileLocale()
  const [reveal, setReveal] = useState(false)
  if (field.type === 'enum' && field.enumValues?.length) return <SelectField label={field.label} value={String(value ?? '')} options={field.enumValues.map((id) => ({ id, label: id }))} onChange={onChange} />
  if (field.type === 'json') return <JsonField label={field.label} value={value} onChange={onChange} onValidity={onValidity} />
  if (['env', 'model-mapping', 'models', 'capabilities'].includes(field.type)) return <View style={styles.tight}><Text style={styles.label}>{field.label}</Text><StructuredValue value={value} onChange={onChange} label={field.label} /></View>
  return <View style={styles.tight}>
    <View style={styles.row}><Text style={[styles.label, styles.grow]}>{t(field.label)}</Text>{field.secret ? <Pressable accessibilityRole="button" onPress={() => setReveal(!reveal)}><Text style={styles.meta}>{t(reveal ? 'Hide' : 'Show')}</Text></Pressable> : null}{field.clearable ? <Pressable accessibilityRole="button" onPress={() => onChange(null)}><Text style={styles.meta}>{t('Reset')}</Text></Pressable> : null}</View>
    {field.type === 'boolean' ? <Switch accessibilityLabel={field.label} value={value === true} trackColor={{ true: tokens.colors.primary }} onValueChange={onChange} /> : field.type === 'number' ? <NumericInput label={field.label} value={value} onChange={onChange} /> : <PromptInput accessibilityLabel={field.label} value={String(value ?? '')} secureTextEntry={field.secret && !reveal} autoCapitalize="none" autoCorrect={false} multiline={!field.secret && field.type === 'string'} onChangeText={onChange} />}
    {field.note ? <Text style={styles.meta}>{field.note}</Text> : null}
    {field.type === 'number' && (field.min !== undefined || field.max !== undefined) ? <Text style={styles.meta}>{field.min !== undefined && field.max !== undefined ? `${field.min} – ${field.max}` : field.min !== undefined ? `Minimum ${field.min}` : `Maximum ${field.max}`}</Text> : null}
  </View>
}

function JsonField({ label, value, onChange, onValidity }: { label: string; value: unknown; onChange: (value: unknown) => void; onValidity?: (valid: boolean) => void }) {
  const styles = usePromptStyles()
  const [text, setText] = useState(() => JSON.stringify(value, null, 2) ?? '')
  const [invalid, setInvalid] = useState(false)
  const { t } = useMobileLocale()
  useEffect(() => () => onValidity?.(true), [])
  return <View style={styles.tight}><Text style={styles.label}>{t(label)}</Text><PromptInput accessibilityLabel={label} multiline autoCapitalize="none" autoCorrect={false} value={text} onChangeText={(next) => { setText(next); try { const parsed: unknown = JSON.parse(next); onChange(parsed); setInvalid(false); onValidity?.(true) } catch { setInvalid(true); onValidity?.(false) } }} />{invalid ? <Text style={styles.warningText}>{t('Enter valid JSON before applying.')}</Text> : null}</View>
}

/** Typed rows preserve objects/arrays; only the explicit JSON field uses a JSON editor. */
function StructuredValue({ value, label, onChange }: { value: unknown; label: string; onChange: (value: unknown) => void }) {
  const styles = usePromptStyles()
  const { t } = useMobileLocale()
  const [newKey, setNewKey] = useState('')
  if (Array.isArray(value)) return <View style={styles.tight}>{value.map((item, index) => <View key={index} style={styles.card}><StructuredValue value={item} label={`${label} ${index + 1}`} onChange={(next) => onChange(value.map((entry, i) => i === index ? next : entry))} /><Pressable accessibilityRole="button" accessibilityLabel={`${t('Remove')} ${label} ${index + 1}`} onPress={() => onChange(value.filter((_, i) => i !== index))}><Text style={styles.meta}>{t('Remove')}</Text></Pressable></View>)}<Pressable accessibilityRole="button" onPress={() => onChange([...value, ''])}><Text style={styles.body}>{t('+ Add item')}</Text></Pressable></View>
  if (value && typeof value === 'object') return <View style={styles.tight}>{Object.entries(value).map(([key, item]) => <View key={key} style={styles.card}><StructuredValue value={item} label={key} onChange={(next) => onChange({ ...value, [key]: next })} /><Pressable accessibilityRole="button" accessibilityLabel={`${t('Remove')} ${key}`} onPress={() => onChange(Object.fromEntries(Object.entries(value).filter(([name]) => name !== key)))}><Text style={styles.meta}>{t('Remove')}</Text></Pressable></View>)}<View style={styles.row}><PromptInput accessibilityLabel={`New ${label} key`} placeholder={t('New key')} value={newKey} onChangeText={setNewKey} style={styles.grow} /><Pressable accessibilityRole="button" disabled={!newKey.trim() || Object.hasOwn(value, newKey.trim())} onPress={() => { onChange({ ...value, [newKey.trim()]: '' }); setNewKey('') }}><Text style={styles.body}>{t('Add')}</Text></Pressable></View></View>
  return <EditableField field={{ label, type: typeof value === 'boolean' ? 'boolean' : typeof value === 'number' ? 'number' : 'string' }} value={value} onChange={onChange} />
}

function NumericInput({ label, value, onChange }: { label: string; value: unknown; onChange: (value: unknown) => void }) {
  const [text, setText] = useState(String(value ?? ''))
  const emitted = useRef(value)
  useEffect(() => {
    if (!Object.is(value, emitted.current)) setText(String(value ?? ''))
    emitted.current = value
  }, [value])
  return <PromptInput accessibilityLabel={label} value={text} keyboardType="numbers-and-punctuation" onChangeText={(next) => {
    setText(next)
    const number = next.trim() ? Number(next) : null
    emitted.current = number
    onChange(number)
  }} />
}
