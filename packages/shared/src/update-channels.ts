import type { UpdateChannel } from './agent-types'

export type YmlChannel = 'latest' | 'beta' | 'alpha'

export const UPDATE_CHANNELS: readonly UpdateChannel[] = ['stable', 'beta', 'alpha']

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
