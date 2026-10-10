import type { EnvironmentListItem } from '@superone/shared/environment'

/** Storybook-only fixtures for the "Control other devices" panel. */

const ssh = (id: string, label: string, target: string, patch: Partial<EnvironmentListItem> = {}): EnvironmentListItem => ({
  connectionId: id,
  environmentId: `env-${id}`,
  label,
  kind: 'remote',
  state: 'disconnected',
  endpointProfiles: [{ endpointId: `${id}-ssh`, kind: 'ssh-forward', label: target, target }],
  preferredEndpointId: `${id}-ssh`,
  platform: { os: 'linux', arch: 'x64' },
  ...patch,
})

const desktop = (id: string, label: string, url: string, patch: Partial<EnvironmentListItem> = {}): EnvironmentListItem => ({
  connectionId: id,
  environmentId: `env-${id}`,
  label,
  kind: 'remote',
  state: 'disconnected',
  endpointProfiles: [{ endpointId: 'primary', kind: 'direct-wss', label: url, target: url }],
  preferredEndpointId: 'primary',
  platform: { os: 'darwin', arch: 'arm64' },
  ...patch,
})

export const ENVIRONMENT_ITEMS: EnvironmentListItem[] = [
  desktop('studio', 'Hangqis-Studio', 'http://Hangqis-Studio.local:7791', { state: 'connected', activePath: 'lan' }),
  ssh('build-box', 'build-box', 'dev@build-box.internal', { state: 'connected', activePath: 'ssh' }),
  ssh('gpu', 'gpu-workstation', 'hangqi@10.0.0.42', {
    nodeUpgrade: { remoteVersion: '0.69.0', targetVersion: '0.71.2', canUpgradeOverSsh: true },
  }),
  ssh('legacy', 'legacy-node', 'dev@legacy.internal', {
    state: 'blocked',
    blockReason: 'protocol_incompatible',
    lastError: 'protocol generation mismatch: local 1-1, remote 2-2',
    nodeUpgrade: { remoteVersion: null, targetVersion: '0.71.2', canUpgradeOverSsh: true },
  }),
  ssh('staging', 'staging', 'deploy@staging.example.com', {
    state: 'backoff',
    lastError: 'connect ECONNREFUSED 127.0.0.1:7788',
  }),
  ssh('old-laptop', 'old-laptop', 'me@old-laptop.local', {
    state: 'blocked',
    blockReason: 'auth',
    lastError: 'Refresh token rejected by node',
  }),
  ssh('rebuilt', 'rebuilt-server-with-a-rather-long-hostname-that-truncates', 'root@rebuilt-server-with-a-rather-long-hostname.example.com', {
    state: 'blocked',
    blockReason: 'identity_conflict',
    lastError: 'Node fingerprint changed since pairing',
  }),
]

/** A desktop node reached each way it can be: LAN, Tailscale, relay, and while reconnecting. */
export const DESKTOP_PATH_ITEMS: EnvironmentListItem[] = [
  desktop('studio', 'Hangqis-Studio', 'http://Hangqis-Studio.local:7791', { state: 'connected', activePath: 'lan' }),
  desktop('office', 'Office-iMac', 'http://Office-iMac.local:7791', { state: 'connected', activePath: 'tailscale' }),
  desktop('travel', 'hangqi-studio-display-workstation-with-a-very-long-bonjour-name', 'http://hangqi-studio-display-workstation-with-a-very-long-bonjour-name.local:47791', { state: 'connected', activePath: 'relay' }),
  desktop('home', 'Home-Mini', 'http://Home-Mini.local:7791', { state: 'backoff', lastError: 'node left the relay' }),
]

/** Desktop nodes that are not simply online: offline, control paused there, connecting, unpaired, replaced. */
export const DESKTOP_STATUS_ITEMS: EnvironmentListItem[] = [
  desktop('studio', 'Hangqis-Studio', 'http://Hangqis-Studio.local:7791', { state: 'connected', activePath: 'lan' }),
  desktop('mini', 'VensendeMac-mini', 'http://VensendeMac-mini.local:7792', {
    state: 'backoff',
    lastError: 'the node is offline: it is not connected to the relay',
  }),
  desktop('office', 'Office-iMac', 'http://Office-iMac.local:7791', {
    state: 'backoff',
    lastError: 'unauthorized: client session suspended',
  }),
  desktop('home', 'Home-Mini', 'http://Home-Mini.local:7791', { state: 'connecting' }),
  desktop('old', 'Old-MacBook', 'http://Old-MacBook.local:7791', {
    state: 'blocked',
    blockReason: 'revoked',
    lastError: 'client session revoked',
  }),
  desktop('rebuilt', 'rebuilt-mac-studio-with-a-rather-long-bonjour-name-that-truncates', 'http://rebuilt.local:7791', {
    state: 'blocked',
    blockReason: 'identity_conflict',
    lastError: 'Node fingerprint changed since pairing',
  }),
]

const REMOTE_HARNESSES = [
  { id: 'claude', runtimeSource: 'bundled', enabled: true, state: 'ready', requiresAuth: true },
  { id: 'codex', runtimeSource: 'bundled', enabled: true, state: 'needs_auth', requiresAuth: true },
  { id: 'opencode', runtimeSource: 'managed', enabled: false, state: 'disabled', requiresAuth: false },
]

/**
 * Replace `window.environment` for one story; returns the restore function for `beforeEach`.
 * `items: null` keeps the list loading forever.
 */
export function mockEnvironmentApi(items: EnvironmentListItem[] | null, opts: { labReachable?: boolean } = {}): () => void {
  const previous = window.environment
  const ok = async () => undefined
  window.environment = {
    ...previous,
    listItems: () => (items ? Promise.resolve(items) : new Promise(() => {})),
    onStatusEvent: () => () => {},
    onInstallProgress: () => () => {},
    listSshConfigHosts: async () => [],
    listHarnesses: async () => REMOTE_HARNESSES,
    localLabStatus: async () => ({
      available: true,
      baseUrl: 'http://127.0.0.1:7789',
      label: 'local-dev-lab',
      nodeHome: '/tmp/superone-lab',
      reachable: opts.labReachable ?? false,
      startHint: 'bun run dev:cli:lab',
    }),
    connect: ok,
    disconnect: ok,
    forget: ok,
    retryNow: async () => 'retrying',
    enableHarness: ok,
    disableHarness: ok,
  } as unknown as typeof window.environment
  return () => { window.environment = previous }
}
