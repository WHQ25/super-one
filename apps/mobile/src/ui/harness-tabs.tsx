import { useState } from 'react'
import { ChevronDown } from 'lucide-react-native'
import { Pressable, View } from 'react-native'
import { Text } from './text'
import type { HarnessId } from '@superone/shared/agent-types'
import { harnessTabSlots } from '../harness-tab-state'
import { harnessDisplayName } from '../provider-state'
import { useMobileTheme } from '../theme/context'
import { AnchoredMenu, MenuRow, useMenuAnchor } from './anchored-menu'

/**
 * Desktop's two-slot harness switcher: slot one is the product default, slot
 * two stands for everything else and turns into a menu past two harnesses.
 */
export function HarnessTabs(props: {
  harnesses: readonly HarnessId[]
  value: HarnessId
  onChange: (harness: HarnessId) => void
  disabled?: boolean
}) {
  const { tokens: { colors, radius } } = useMobileTheme()
  const menu = useMenuAnchor()
  const [remembered, setRemembered] = useState<HarnessId | null>(null)
  const slots = harnessTabSlots({ harnesses: props.harnesses, active: props.value, remembered })
  if (!slots) return null
  const { fixed, menuTab, menuActive } = slots
  const pick = (harness: HarnessId, fromMenu: boolean) => {
    if (fromMenu) setRemembered(harness)
    if (harness !== props.value) props.onChange(harness)
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
        accessibilityLabel={harnessDisplayName(fixed)} disabled={props.disabled}
        onPress={() => pick(fixed, false)} style={slotStyle(!menuActive)}>
        <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: '500', color: menuActive ? colors.mutedForeground : colors.foreground }}>
          {harnessDisplayName(fixed)}
        </Text>
      </Pressable>
      {menuTab ? <Pressable ref={menu.ref} accessibilityRole="tab"
        accessibilityState={{ selected: menuActive, disabled: props.disabled, expanded: !!menu.anchor }}
        accessibilityLabel={harnessDisplayName(menuTab)} disabled={props.disabled}
        // A single remaining harness is a plain tab; more than one opens the menu.
        onPress={() => { if (slots.menu.length === 1) pick(menuTab, true); else if (menuActive) menu.open(); else pick(menuTab, true) }}
        style={slotStyle(menuActive)}>
        <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: '500', color: menuActive ? colors.foreground : colors.mutedForeground }}>
          {harnessDisplayName(menuTab)}
        </Text>
        {slots.menu.length > 1 ? <ChevronDown size={14} color={colors.mutedForeground}
          style={{ transform: [{ rotate: menu.anchor ? '180deg' : '0deg' }] }} /> : null}
      </Pressable> : null}
    </View>
    <AnchoredMenu anchor={menu.anchor} title="Agent" onDismiss={menu.close} width={240}>
      {slots.menu.map((harness) => <MenuRow key={harness} label={harnessDisplayName(harness)}
        selected={harness === props.value}
        onPress={() => { menu.close(); pick(harness, true) }} />)}
    </AnchoredMenu>
  </>
}
