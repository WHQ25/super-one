import { BUILTIN_CAPABILITY_IDS, type BuiltinCapabilityId } from './capability-prompt-tags'

export function isComputerUseSupportedPlatform(platform: string): boolean {
  return platform === 'darwin'
}

/** UI availability, not a permission grant. Actual tools still enforce consent. */
export function mentionCapabilityAvailability(settings: { computerUseEnabled?: boolean; cdpEnabled?: boolean } | null | undefined, platform: string): Record<BuiltinCapabilityId, boolean> {
  return {
    computer: isComputerUseSupportedPlatform(platform) && settings?.computerUseEnabled === true,
    browser: settings?.cdpEnabled === true,
    widget: true,
    debug: true,
  }
}

export function availableMentionCapabilityIds(settings: { computerUseEnabled?: boolean; cdpEnabled?: boolean }, platform: string): BuiltinCapabilityId[] {
  const enabled = mentionCapabilityAvailability(settings, platform)
  return BUILTIN_CAPABILITY_IDS.filter((id) => enabled[id])
}
