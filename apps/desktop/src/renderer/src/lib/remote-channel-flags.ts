/**
 * Feature flags for "control other devices" connection channels.
 * Only SSH is shipped; desktop and Tailscale stay hidden until ready.
 */
export type RemoteDeviceChannel = 'desktop' | 'ssh' | 'tailscale'

export const REMOTE_CHANNEL_ENABLED: Record<RemoteDeviceChannel, boolean> = {
  desktop: false,
  ssh: true,
  tailscale: false,
}

export function enabledRemoteChannels(): RemoteDeviceChannel[] {
  return (Object.keys(REMOTE_CHANNEL_ENABLED) as RemoteDeviceChannel[]).filter(
    (id) => REMOTE_CHANNEL_ENABLED[id],
  )
}
