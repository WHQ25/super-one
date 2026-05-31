import type { UpdateChannel } from './agent-types'

export type YmlChannel = 'latest' | 'beta' | 'alpha'

export const UPDATE_CHANNELS: readonly UpdateChannel[] = ['stable', 'beta', 'alpha']

// Channels currently safe to expose in the settings selector. `beta` / `stable`
// have no published manifest on R2 yet, so offering them would 404 on switch
// (electron-updater errors). Widen this to the full list once those channels
// are populated by a real beta/stable release via set-latest.
export const AVAILABLE_UPDATE_CHANNELS: readonly UpdateChannel[] = ['alpha']

export const UPDATE_CHANNEL_TO_YML: Record<UpdateChannel, YmlChannel> = {
  stable: 'latest',
  beta: 'beta',
  alpha: 'alpha',
}

export function channelFromVersion(version: string): UpdateChannel {
  if (/-alpha/i.test(version)) return 'alpha'
  if (/-beta/i.test(version)) return 'beta'
  return 'stable'
}
