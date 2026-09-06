import { Fragment } from 'react'
import { AlertTriangle, Bot, ChevronDown, Eye, FastForward, ListTodo, Lock, MessageCircle, PenLine, Shield, ShieldCheck, ShieldOff, Unlock, Zap, type LucideIcon } from 'lucide-react-native'
import { Pressable, View } from 'react-native'
import { Text } from './text'
import type { HarnessId } from '@superone/shared/agent-types'
import { useMobileTheme } from '../theme/context'
import { AnchoredMenu, MenuSeparator, useMenuAnchor } from './anchored-menu'
import { orderedPermissionModes, permissionPresentation } from './permission-mode-data'

export { permissionModeLabel } from './permission-mode-data'
const icons: Record<string, LucideIcon> = { AlertTriangle, Bot, Eye, FastForward, ListTodo, Lock, MessageCircle, PenLine, Shield, ShieldCheck, ShieldOff, Unlock, Zap }

export function PermissionModeSelector({ harness, modes, value, onChange, disabled = false }: {
  harness: HarnessId; modes: string[]; value: string; onChange: (mode: string) => void; disabled?: boolean
}) {
  const menu = useMenuAnchor()
  const { tokens } = useMobileTheme()
  const { colors } = tokens
  const tone = (entry: ReturnType<typeof permissionPresentation>) => {
    const value = entry[tokens.scheme]
    return value.startsWith('$') ? colors[value.slice(1) as keyof typeof colors] ?? colors.foreground : value
  }
  const selected = permissionPresentation(harness, value)
  const TriggerIcon = icons[selected.triggerIcon] ?? Shield
  const available = orderedPermissionModes(harness, modes)
  return <>
    <Pressable ref={menu.ref} disabled={disabled || !modes.length} accessibilityRole="button" accessibilityLabel={`Permission mode: ${selected.label}`}
      accessibilityState={{ disabled: disabled || !modes.length, expanded: !!menu.anchor }} onPress={menu.open}
      style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 4,
        borderRadius: 8, opacity: disabled ? 0.45 : 1, backgroundColor: pressed ? colors.muted : 'transparent' })}>
      <TriggerIcon color={tone(selected)} size={14} />
      <Text style={{ color: tone(selected), fontSize: 12 }}>{selected.label}</Text>
      <ChevronDown color={tone(selected)} size={12} style={{ transform: [{ rotate: menu.anchor ? '180deg' : '0deg' }] }} />
    </Pressable>
    <AnchoredMenu anchor={menu.anchor} title="Permission mode" onDismiss={menu.close} width={300}>
      {available.map((mode) => {
        const entry = permissionPresentation(harness, mode)
        const Icon = icons[entry.icon] ?? Shield
        const color = tone(entry)
        const active = mode === value
        return <Fragment key={mode}>
          {mode === 'dontAsk' ? <MenuSeparator /> : null}
          <Pressable accessibilityRole="radio" accessibilityState={{ checked: active }} onPress={() => { onChange(mode); menu.close() }}
            style={({ pressed }) => ({ minHeight: 44, padding: 8, gap: 4, borderRadius: 6, backgroundColor: active || pressed ? `${color}20` : 'transparent' })}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Icon color={color} size={14} />
              <Text style={{ color, fontSize: 13, fontWeight: '500' }}>{entry.label}</Text>
            </View>
            <Text style={{ color: colors.mutedForeground, fontSize: 12, lineHeight: 18 }}>{entry.description}</Text>
          </Pressable>
        </Fragment>
      })}
    </AnchoredMenu>
  </>
}
