import type { RemoteHarnessOption } from '@superone/shared/agent-types'

export type HarnessTabSlots = {
  /** Always-visible first slot: the host's default harness. */
  fixed: RemoteHarnessOption
  /** Everything the second slot can stand for. */
  menu: RemoteHarnessOption[]
  /** Option the second slot currently names, or null when there is nothing to name. */
  menuTab: RemoteHarnessOption | null
  /** True when the selection lives in the second slot rather than the first. */
  menuActive: boolean
}

/**
 * Split the host's harness options into the desktop's two-slot switcher (see
 * `ProviderSelector` in `ChatSuggestions.tsx`): slot one is fixed, slot two
 * stands for every remaining option and becomes a menu once there is more than
 * one. Returns null when there is nothing to switch between.
 *
 * Options arrive already ordered and labelled by the host, so an ACP agent is
 * its own row named `Grok Build` rather than the `acp` harness called `Others`.
 */
export function harnessTabSlots(input: {
  options: readonly RemoteHarnessOption[]
  /** Suggestion key of the active option, as `RemoteHarnessOption.key`. */
  activeKey: string
  /** The user's last pick from the menu, honoured while the fixed slot is active. */
  rememberedKey?: string | null
}): HarnessTabSlots | null {
  const seen = new Set<string>()
  const ordered = input.options.filter((option) => !seen.has(option.key) && seen.add(option.key))
  const fixed = ordered[0]
  if (!fixed || ordered.length < 2) return null
  const menu = ordered.slice(1)
  const menuActive = menu.some((option) => option.key === input.activeKey)
  const menuTab = menu.find((option) => option.key === input.activeKey)
    ?? menu.find((option) => option.key === input.rememberedKey)
    ?? menu[0]
    ?? null
  return { fixed, menu, menuTab, menuActive }
}
