import { useState } from 'react'
import { ChevronDown } from 'lucide-react-native'
import { Pressable, View } from 'react-native'
import { Text } from './text'
import type { RemoteHarnessOption } from '@superone/shared/agent-types'
import { harnessTabSlots } from '../harness-tab-state'
import { useMobileTheme } from '../theme/context'
import { AnchoredMenu, MenuRow, useMenuAnchor } from './anchored-menu'

/**
 * Desktop's two-slot harness switcher: slot one is the host's default, slot two
 * stands for everything else and turns into a menu past two options. Labels and
 * order come from the host, so they read exactly as the desktop's do.
 */
export function HarnessTabs(props: {
  options: readonly RemoteHarnessOption[]
  activeKey: string
  onChange: (option: RemoteHarnessOption) => void
  disabled?: boolean
}) {
  const { tokens: { colors, radius } } = useMobileTheme()
  const menu = useMenuAnchor()
  const [rememberedKey, setRememberedKey] = useState<string | null>(null)
  const slots = harnessTabSlots({ options: props.options, activeKey: props.activeKey, rememberedKey })
  if (!slots) return null
  const { fixed, menuTab, menuActive } = slots
  const pick = (option: RemoteHarnessOption, fromMenu: boolean) => {
    if (fromMenu) setRememberedKey(option.key)
    if (option.key !== props.activeKey) props.onChange(option)
  }
  const slotStyle = (active: boolean) => ({
    minHeight: 32, justifyContent: 'center' as const, alignItems: 'center' as const,
    flexDirection: 'row' as const, gap: 4, paddingHorizontal: 16, borderRadius: radius.sm,
    backgroundColor: active ? colors.background : 'transparent',
  })
  return <>
    <View style={{ flexDirection: 'row', padding: 2, gap: 2, borderWidth: 1, borderColor: colors.border,
      borderRadius: radius.md, backgroundColor: colors.muted }}>
      <Pressable accessibilityRole="tab" accessibilityState={{ selected: !menuActive, disabled: props.disabled }}
        accessibilityLabel={fixed.label} disabled={props.disabled}
        onPress={() => pick(fixed, false)} style={slotStyle(!menuActive)}>
        <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: '500', color: menuActive ? colors.mutedForeground : colors.foreground }}>
          {fixed.label}
        </Text>
      </Pressable>
      {menuTab ? <Pressable ref={menu.ref} accessibilityRole="tab"
        accessibilityState={{ selected: menuActive, disabled: props.disabled, expanded: !!menu.anchor }}
        accessibilityLabel={menuTab.label} disabled={props.disabled}
        // A single remaining harness is a plain tab; more than one opens the menu.
        onPress={() => { if (slots.menu.length === 1) pick(menuTab, true); else if (menuActive) menu.open(); else pick(menuTab, true) }}
        style={slotStyle(menuActive)}>
        <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: '500', color: menuActive ? colors.foreground : colors.mutedForeground }}>
          {menuTab.label}
        </Text>
        {slots.menu.length > 1 ? <ChevronDown size={14} color={colors.mutedForeground}
          style={{ transform: [{ rotate: menu.anchor ? '180deg' : '0deg' }] }} /> : null}
      </Pressable> : null}
    </View>
    <AnchoredMenu anchor={menu.anchor} title="Agent" onDismiss={menu.close} width={240}>
      {slots.menu.map((option) => <MenuRow key={option.key} label={option.label}
        selected={option.key === props.activeKey}
        onPress={() => { menu.close(); pick(option, true) }} />)}
    </AnchoredMenu>
  </>
}
