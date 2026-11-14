import {
  defaultNodeRemotePort,
  nodeChannelForVariant,
  nodeCliName,
  otherNodeChannelOf,
  type NodeChannel,
} from '@superone/shared/environment/client-view'
import { posix } from 'node:path'
import { superoneHomeSegments } from '@superone/runtime/fs/superone-home'
import { variantId } from '../variant'

/**
 * The remote node channel follows this desktop's build identity, so a dev
 * desktop installs and restarts only the dev node, never alpha or stable.
 */
export function remoteDataChannel(): NodeChannel {
  return nodeChannelForVariant(variantId())
}

/** Resolve against the remote home; never forward the desktop's HOME override. */
export function remoteSuperoneHome(home: string): string {
  return posix.join(home, ...superoneHomeSegments(remoteDataChannel()))
}

export function remoteCliName(): string {
  return nodeCliName(remoteDataChannel())
}

export function remoteNodePort(): number {
  return defaultNodeRemotePort(remoteDataChannel())
}

export function remoteSystemdUnitName(): string {
  return `${remoteCliName()}.service`
}

/**
 * Refuse a dev desktop operation aimed at a stable or alpha node: it would run
 * the dev build on that node's data, or start and pair that channel's node.
 * Records paired before the dev channel existed point there; they must be
 * removed and added again.
 */
export function assertDevChannelTarget(target: { nodeHome?: string; port: number; remoteExec?: string }): void {
  const channel = otherNodeChannelOf('dev', target)
  if (!channel) return
  throw Object.assign(
    new Error(
      `This node target belongs to the ${channel} channel (${[target.nodeHome, target.remoteExec, `port ${target.port}`].filter(Boolean).join(', ')}). ` +
        'A dev build works only with dev-channel nodes; remove this node and add the host again.',
    ),
    { code: 'failed_precondition' },
  )
}
