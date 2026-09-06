import type { HarnessId } from '@superone/shared/agent-types'

export type HarnessTabSlots = {
  /** Always-visible first slot: the product-default harness. */
  fixed: HarnessId
  /** Everything the second slot can stand for. */
  menu: HarnessId[]
  /** Harness the second slot currently names, or null when there is nothing to name. */
  menuTab: HarnessId | null
  /** True when the selection lives in the second slot rather than the first. */
  menuActive: boolean
}

/**
 * Split the enabled harnesses into the desktop's two-slot switcher (see
 * `ProviderSelector` in `ChatSuggestions.tsx`): slot one is fixed, slot two
 * stands for every remaining harness and becomes a menu once there is more
 * than one. Returns null when there is nothing to switch between.
 */
export function harnessTabSlots(input: {
  harnesses: readonly HarnessId[]
  active: HarnessId
  /** The user's last pick from the menu, honoured while the fixed slot is active. */
  remembered?: HarnessId | null
}): HarnessTabSlots | null {
  const ordered = [...new Set(input.harnesses)]
  const fixed = ordered[0]
  if (!fixed || ordered.length < 2) return null
  const menu = ordered.slice(1)
  const menuActive = menu.includes(input.active)
  const remembered = input.remembered
  const menuTab = menuActive
    ? input.active
    : remembered && menu.includes(remembered)
      ? remembered
      : menu[0] ?? null
  return { fixed, menu, menuTab, menuActive }
}
