import { useMemo, useState } from 'react'
import { Check, ChevronDown, Shield } from 'lucide-react-native'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useMobileTheme } from '../theme/context'
import { ListRow, Sheet } from './primitives'

const MODE_LABELS: Record<string, string> = {
  default: 'Ask before changes',
  acceptEdits: 'Accept edits',
  bypassPermissions: 'Bypass permissions',
  plan: 'Plan mode',
  dontAsk: "Don't ask",
  auto: 'Auto',
  agent: 'Agent decides',
}

export function permissionModeLabel(mode: string): string {
  return MODE_LABELS[mode] ?? mode
}

export function PermissionModeSelector(props: {
  modes: string[]
  value: string
  onChange: (mode: string) => void
}) {
  const [open, setOpen] = useState(false)
  const { tokens } = useMobileTheme()
  const styles = useMemo(() => StyleSheet.create({
    trigger: {
      alignSelf: 'flex-start',
      alignItems: 'center',
      flexDirection: 'row',
      gap: tokens.spacing.xs,
      minHeight: 30,
      paddingHorizontal: tokens.spacing.sm,
      borderRadius: tokens.radius.pill,
      backgroundColor: tokens.colors.secondary,
    },
    label: { color: tokens.colors.mutedForeground, fontSize: tokens.type.meta, fontWeight: '600' },
    list: { maxHeight: 420 },
  }), [tokens])
  return (
    <>
      <Pressable
        accessibilityLabel="Permission mode"
        accessibilityRole="button"
        onPress={() => setOpen(true)}
        style={styles.trigger}
      >
        <Shield color={tokens.colors.mutedForeground} size={14} />
        <Text style={styles.label}>{permissionModeLabel(props.value)}</Text>
        <ChevronDown color={tokens.colors.mutedForeground} size={14} />
      </Pressable>
      <Sheet visible={open} title="Permission mode" onDismiss={() => setOpen(false)}>
        <View style={styles.list}>
          {props.modes.map((mode) => (
            <ListRow
              key={mode}
              title={permissionModeLabel(mode)}
              selected={mode === props.value}
              trailing={mode === props.value ? <Check color={tokens.colors.primary} size={18} /> : <View />}
              onPress={() => {
                props.onChange(mode)
                setOpen(false)
              }}
            />
          ))}
        </View>
      </Sheet>
    </>
  )
}
