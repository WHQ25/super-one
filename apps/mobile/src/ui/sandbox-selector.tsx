import { Box, PackageOpen } from 'lucide-react-native'
import { Pressable, View } from 'react-native'
import type { HarnessId, SandboxInfo, SandboxMode } from '@superone/shared/agent-types'
import {
  harnessSandboxModes,
  harnessSupportsSandbox,
  resolveSandboxMode,
} from '@superone/shared/harness/harness-sandbox'
import { Text } from './text'
import { useMobileTheme } from '../theme/context'
import { AnchoredMenu, useMenuAnchor } from './anchored-menu'

type Presentation = {
  label: string
  description: string
  icon: typeof Box
  /** Key into the theme palette, so light and dark both stay on semantic tokens. */
  tone: 'mutedForeground' | 'success' | 'warning'
}

const PRESENTATION: Record<SandboxMode, Presentation> = {
  off: { label: 'Sandbox Off', description: 'No execution isolation', icon: PackageOpen, tone: 'mutedForeground' },
  on: { label: 'Sandbox', description: 'Commands run in a sandboxed environment', icon: Box, tone: 'success' },
  auto: { label: 'Sandbox Auto', description: 'Sandbox with auto-allow Bash', icon: Box, tone: 'warning' },
}

export type SandboxSelectorProps = {
  harness: HarnessId
  /** Claude/Cursor: the session's own setting. ACP: the sandbox Grok reported. */
  sandboxInfo: SandboxInfo | null
  permissionMode: string
  onChange: (mode: SandboxMode) => void
  disabled?: boolean
}

/**
 * Sandbox chip — shown for every harness, matching the desktop status bar. Claude
 * and Cursor drive a real toggle; the rest fold sandbox into their permission
 * setting (or have none), so their chip is read-only and derived from that setting
 * rather than offering a switch that would contradict it.
 */
export function SandboxSelector({ harness, sandboxInfo, permissionMode, onChange, disabled = false }: SandboxSelectorProps) {
  const menu = useMenuAnchor()
  const { tokens: { colors } } = useMobileTheme()
  const value = resolveSandboxMode({ harnessId: harness, sandboxInfo, permissionMode })
  const current = PRESENTATION[value]
  const CurrentIcon = current.icon
  const interactive = harnessSupportsSandbox(harness) && !disabled
  const available = harnessSandboxModes(harness)

  // Glyph only: the mode's colour carries the state at a glance, and the label is a
  // tap away in the menu. The row already spends its width on the model name.
  if (!interactive) {
    return <View accessibilityRole="text" accessibilityLabel={current.label}
      style={{ minHeight: 44, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', opacity: disabled ? 0.45 : 1 }}>
      <CurrentIcon color={colors[current.tone]} size={16} />
    </View>
  }

  return <>
    <Pressable ref={menu.ref} accessibilityRole="button" accessibilityLabel={`Sandbox: ${current.label}`}
      accessibilityState={{ expanded: !!menu.anchor }} onPress={menu.open}
      style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center',
        borderRadius: 8, backgroundColor: pressed ? colors.muted : 'transparent' })}>
      <CurrentIcon color={colors[current.tone]} size={16} />
    </Pressable>
    <AnchoredMenu anchor={menu.anchor} title="Sandbox" onDismiss={menu.close} width={280}>
      {available.map((mode) => {
        const entry = PRESENTATION[mode]
        const Icon = entry.icon
        const color = colors[entry.tone]
        const active = mode === value
        return <Pressable key={mode} accessibilityRole="radio" accessibilityState={{ checked: active }}
          onPress={() => { onChange(mode); menu.close() }}
          style={({ pressed }) => ({ minHeight: 44, padding: 8, gap: 4, borderRadius: 6, backgroundColor: active || pressed ? `${color}20` : 'transparent' })}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Icon color={color} size={14} />
            <Text style={{ color, fontSize: 13, fontWeight: '500' }}>{entry.label}</Text>
          </View>
          <Text style={{ color: colors.mutedForeground, fontSize: 12, lineHeight: 18 }}>{entry.description}</Text>
        </Pressable>
      })}
    </AnchoredMenu>
  </>
}
