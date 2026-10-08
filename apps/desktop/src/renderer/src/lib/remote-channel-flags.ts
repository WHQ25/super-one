/**
 * Feature flags for "control other devices" connection channels.
 * SSH and desktop (pairing code) are shipped; Tailscale stays hidden until ready.
 */
export type RemoteDeviceChannel = 'desktop' | 'ssh' | 'tailscale'

export const REMOTE_CHANNEL_ENABLED: Record<RemoteDeviceChannel, boolean> = {
  desktop: true,
  ssh: true,
  tailscale: false,
}

export function enabledRemoteChannels(): RemoteDeviceChannel[] {
  return (Object.keys(REMOTE_CHANNEL_ENABLED) as RemoteDeviceChannel[]).filter(
    (id) => REMOTE_CHANNEL_ENABLED[id],
  )
}
