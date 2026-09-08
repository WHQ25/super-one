import { defaultNodeRemotePort } from '@superone/shared/environment/client-view'
import { posix } from 'node:path'
import { superoneHomeSegments } from '@superone/runtime/fs/superone-home'
import { harnessManifestChannelForVariant } from '../variant'

export function remoteDataChannel(version?: string): 'stable' | 'alpha' {
  return version === undefined ? harnessManifestChannelForVariant() : /-alpha(?:[.-]|$)/.test(version) ? 'alpha' : 'stable'
}

/** Resolve against the remote home; never forward the desktop's HOME override. */
export function remoteSuperoneHome(home: string, version?: string): string {
  return posix.join(home, ...superoneHomeSegments(remoteDataChannel(version)))
}

export function remoteCliName(version?: string): string {
  return remoteDataChannel(version) === 'alpha' ? 'superone-alpha' : 'superone'
}

export function remoteNodePort(): number {
  return defaultNodeRemotePort(remoteDataChannel())
}

export function remoteSystemdUnitName(): string {
  return `${remoteCliName()}.service`
}
