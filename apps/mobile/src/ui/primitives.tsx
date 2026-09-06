import { useMemo, type ReactNode } from 'react'
import { ChevronRight, SlidersHorizontal, type LucideIcon } from 'lucide-react-native'
import { Pressable, StyleSheet, View } from 'react-native'
import { Text } from './text'
import { useMobileTheme } from '../theme/context'
import { PromptSheet } from '../prompts/PromptSheet'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

export function Button(props: {
  label: string
  onPress: () => void
  variant?: ButtonVariant
  disabled?: boolean
  icon?: LucideIcon
}) {
  const styles = usePrimitiveStyles()
  const { tokens } = useMobileTheme()
  const variant = props.variant ?? 'primary'
  const Icon = props.icon
  const color = variant === 'primary'
    ? tokens.colors.primaryForeground
    : variant === 'danger'
      ? tokens.colors.error
      : tokens.colors.foreground
  return (
    <Pressable
      accessibilityRole="button"
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.button,
        styles[`${variant}Button`],
        pressed && styles.pressed,
        props.disabled && styles.disabled,
      ]}
    >
      {Icon ? <Icon color={color} size={17} strokeWidth={2} /> : null}
      <Text style={[styles.buttonLabel, { color }]}>{props.label}</Text>
    </Pressable>
  )
}

export function ListRow(props: {
  title: string
  subtitle?: string
  onPress?: () => void
  selected?: boolean
  leading?: ReactNode
  trailing?: ReactNode
}) {
  const styles = usePrimitiveStyles()
  const { tokens } = useMobileTheme()
  const content = (
    <>
      {props.leading}
      <View style={styles.listText}>
        <Text numberOfLines={1} style={styles.listTitle}>{props.title}</Text>
        {props.subtitle ? <Text numberOfLines={2} style={styles.listSubtitle}>{props.subtitle}</Text> : null}
      </View>
      {props.trailing ?? (props.onPress ? <ChevronRight color={tokens.colors.mutedForeground} size={18} /> : null)}
    </>
  )
  const style = [styles.listRow, props.selected && styles.selected]
  return props.onPress ? (
    <Pressable accessibilityRole="button" onPress={props.onPress} style={({ pressed }) => [style, pressed && styles.pressed]}>
      {content}
    </Pressable>
  ) : <View style={style}>{content}</View>
}

export function SectionHeader(props: { title: string; badge?: ReactNode; action?: ReactNode }) {
  const styles = usePrimitiveStyles()
  // The badge qualifies the title, so it travels with it rather than drifting
  // to the far edge beside the actions.
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionTitleGroup}>
        <Text style={styles.sectionTitle}>{props.title}</Text>
        {props.badge}
      </View>
      {props.action}
    </View>
  )
}

export function Sheet(props: {
  visible: boolean
  title: string
  children: ReactNode
  onDismiss?: () => void
}) {
  if (!props.visible) return null
  return <PromptSheet title={props.title} icon={SlidersHorizontal} onDismiss={props.onDismiss ?? (() => {})}>
    {props.children}
  </PromptSheet>
}

export function Chip(props: {
  label: string
  selected?: boolean
  onPress?: () => void
}) {
  const styles = usePrimitiveStyles()
  const content = <Text style={styles.chipLabel}>{props.label}</Text>
  return props.onPress ? (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: props.selected }}
      onPress={props.onPress}
      style={({ pressed }) => [styles.chip, props.selected && styles.selectedChip, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  ) : <View style={[styles.chip, props.selected && styles.selectedChip]}>{content}</View>
}

export function Badge(props: { label: string; tone?: 'neutral' | 'success' | 'warning' | 'error' }) {
  const styles = usePrimitiveStyles()
  const { tokens } = useMobileTheme()
  const tone = props.tone ?? 'neutral'
  const color = tone === 'neutral' ? tokens.colors.mutedForeground : tokens.colors[tone]
  return (
    <View style={styles.badge}>
      <Text style={[styles.badgeLabel, { color }]}>{props.label}</Text>
    </View>
  )
}

function usePrimitiveStyles() {
  const { tokens } = useMobileTheme()
  return useMemo(() => {
    const { colors, radius, spacing, type } = tokens
    return StyleSheet.create({
      button: {
        minHeight: 44,
        borderRadius: radius.md,
        paddingHorizontal: 14,
        paddingVertical: 10,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.sm,
      },
      primaryButton: { backgroundColor: colors.primary },
      secondaryButton: { backgroundColor: colors.secondary },
      ghostButton: { backgroundColor: 'transparent' },
      dangerButton: { borderWidth: 1, borderColor: colors.error },
      buttonLabel: { fontSize: type.body, fontWeight: '500' as const },
      pressed: { opacity: 0.7 },
      disabled: { opacity: 0.45 },
      listRow: {
        minHeight: 54,
        paddingVertical: 10,
        paddingHorizontal: spacing.sm,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: colors.border,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
      },
      listText: { flex: 1, minWidth: 0 },
      listTitle: { color: colors.foreground, fontSize: type.body },
      listSubtitle: { color: colors.mutedForeground, fontSize: type.meta, marginTop: spacing.xs },
      selected: { backgroundColor: colors.muted, borderRadius: radius.md },
      sectionHeader: { flexDirection: 'row', alignItems: 'center', minHeight: 32 },
      sectionTitleGroup: { alignItems: 'center', flex: 1, flexDirection: 'row' as const, gap: spacing.xs, minWidth: 0 },
      sectionTitle: { color: colors.foreground, flexShrink: 1, fontSize: type.title, fontWeight: '500' as const },
      chip: {
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radius.pill,
        paddingHorizontal: 10,
        paddingVertical: spacing.xs,
      },
      selectedChip: { borderColor: colors.primary, backgroundColor: colors.muted },
      chipLabel: { color: colors.foreground, fontSize: type.meta },
      badge: { backgroundColor: colors.muted, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 3 },
      badgeLabel: { fontSize: type.meta, fontWeight: '500' as const },
    })
  }, [tokens])
}
