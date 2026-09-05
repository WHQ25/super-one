import { useState, type ReactNode } from 'react'
import { Pressable, Text, TextInput, View, type TextInputProps } from 'react-native'
import { Check, CheckCircle2, Circle, Square, SquareCheck, X, type LucideIcon } from 'lucide-react-native'
import { useMobileTheme } from '../theme/context'
import { usePromptStyles } from './styles'

export function PromptInput(props: TextInputProps) {
  const styles = usePromptStyles()
  const { tokens } = useMobileTheme()
  const [focused, setFocused] = useState(false)
  return <TextInput {...props} placeholderTextColor={tokens.colors.mutedForeground} selectionColor={tokens.colors.primary} onFocus={(event) => { setFocused(true); props.onFocus?.(event) }} onBlur={(event) => { setFocused(false); props.onBlur?.(event) }} style={[styles.input, props.multiline && styles.multiline, focused && styles.focusedInput, props.style]} />
}

export function PromptChoice({ label, description, selected, onPress, multi = false }: {
  label: string; description?: string; selected: boolean; onPress: () => void; multi?: boolean
}) {
  const styles = usePromptStyles()
  const { tokens } = useMobileTheme()
  const Icon = multi ? selected ? SquareCheck : Square : selected ? CheckCircle2 : Circle
  return <Pressable testID={`prompt-option-${label}`} accessibilityRole={multi ? 'checkbox' : 'radio'} accessibilityState={{ checked: selected }} onPress={onPress} style={({ pressed }) => [styles.choice, selected && styles.selectedChoice, pressed && styles.pressed]}>
    <Icon size={16} color={selected ? tokens.colors.primary : tokens.colors.mutedForeground} style={styles.choiceIcon} />
    <View style={styles.grow}><Text style={styles.body}>{label}</Text>{description ? <Text style={styles.meta}>{description}</Text> : null}</View>
  </Pressable>
}

export function PromptPill({ label, selected, onPress, multi = false }: { label: string; selected: boolean; onPress: () => void; multi?: boolean }) {
  const styles = usePromptStyles()
  return <Pressable testID={`prompt-option-${label}`} accessibilityRole={multi ? 'checkbox' : 'radio'} accessibilityState={{ checked: selected }} onPress={onPress} style={({ pressed }) => [styles.pill, selected && styles.selectedPill, pressed && styles.pressed]}>
    <Text style={[styles.pillText, selected && styles.selectedPillText]}>{label}</Text>
  </Pressable>
}

export function PromptActions({ onApprove, onReject, approveLabel, rejectLabel, disabled, destructive, primary, neutralReject, feedback, children }: {
  onApprove: () => void; onReject: () => void; approveLabel: string; rejectLabel: string
  disabled?: boolean; destructive?: boolean; primary?: boolean; neutralReject?: boolean
  feedback?: { value: string; onChange: (text: string) => void; placeholder?: string }
  children?: ReactNode
}) {
  const styles = usePromptStyles()
  return <View style={styles.footer}>
    {feedback ? <PromptInput testID="prompt-feedback" accessibilityLabel={feedback.placeholder ?? 'Optional feedback'} placeholder={feedback.placeholder ?? 'Optional feedback'} value={feedback.value} onChangeText={feedback.onChange} returnKeyType="send" onSubmitEditing={onReject} /> : null}
    {children}
    <View style={styles.row}>
      <Action testID="prompt-approve" label={approveLabel} icon={Check} onPress={onApprove} disabled={disabled} tone={destructive ? 'reject' : primary ? 'primary' : 'approve'} />
      <Action testID="prompt-reject" label={rejectLabel} icon={X} onPress={onReject} tone={neutralReject || destructive ? 'neutral' : 'reject'} />
    </View>
  </View>
}

function Action({ testID, label, icon: Icon, onPress, disabled, tone }: { testID: string; label: string; icon: LucideIcon; onPress: () => void; disabled?: boolean; tone: 'approve' | 'reject' | 'primary' | 'neutral' }) {
  const styles = usePromptStyles()
  const { tokens: { colors } } = useMobileTheme()
  const backgroundColor = tone === 'approve' ? colors.success : tone === 'reject' ? colors.destructive : tone === 'primary' ? colors.primary : colors.background
  const color = tone === 'approve' ? colors.successForeground : tone === 'reject' ? colors.destructiveForeground : tone === 'primary' ? colors.primaryForeground : colors.mutedForeground
  return <Pressable testID={testID} accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.action, { backgroundColor, borderWidth: tone === 'neutral' ? 1 : 0, borderColor: colors.border }, disabled && styles.disabled, pressed && styles.pressed]}>
    <Icon size={14} color={color} /><Text style={[styles.actionText, { color }]}>{label}</Text>
  </Pressable>
}
