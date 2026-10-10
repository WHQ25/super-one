import { hostname } from 'node:os'
import { Notification } from 'electron'
import { AgentIpcChannels } from '@superone/shared/agent-types'
import { t } from '../i18n'
import { openPairRoomSocket } from '../remote/pair-room-socket'
import type { EnvironmentHost } from '../environment/environment-host'
import { cancelNodePairingQr, pairNodeFromCode, startNodePairingQr, type NodePairingHost } from '../environment/node-pairing'
import {
  cancelControllerPairing,
  confirmControllerPairing,
  controllerPairingOpen,
  startControllerPairing,
} from './controller-pairing'

/**
 * Desktop pairing through a phone, wired into main: the controller QR and
 * controller list on the computer being controlled, the node QR on the
 * controller, and the phone's native desktop pairing methods.
 * Contract: docs/architecture/remote-node-service.md §11.5.
 */

export interface DesktopPairingDeps {
  /** Persist and apply `remoteNodeAccessEnabled`. */
  setNodeHostEnabled: (enabled: boolean) => Promise<void>
  send: (channel: string, payload?: unknown) => void
  relayUrl: () => string
  environmentHost: () => Promise<EnvironmentHost>
  /** The experimental remote-nodes setting, which gates desktop pairing. */
  remoteNodesEnabled: () => boolean
}

let deps: DesktopPairingDeps | null = null
let changeBridge = false

export function configureDesktopPairing(next: DesktopPairingDeps): void {
  deps = next
}

function required(): DesktopPairingDeps {
  if (!deps) throw new Error('desktop pairing is not configured')
  return deps
}

/** This computer's name as other devices show it. */
export function desktopName(): string {
  return hostname().replace(/\.local$/i, '')
}

async function nodeHost(): Promise<typeof import('./node-host-controller')> {
  const d = required()
  const module = await import('./node-host-controller')
  module.configureNodeHostLifecycle({ setEnabled: d.setNodeHostEnabled, pairingOpen: controllerPairingOpen })
  if (!changeBridge) {
    changeBridge = true
    module.onNodeHostChanged(() => d.send(AgentIpcChannels.NODE_HOST_CHANGED))
  }
  return module
}

/** After a start with the host on: stop it when nothing needs it any more. */
export async function reconcileNodeHostAtStartup(): Promise<void> {
  await (await nodeHost()).reconcileNodeHost()
}

export async function listControllers() {
  return (await nodeHost()).listNodeHostControllers()
}

export async function setControllerEnabled(id: string, enabled: boolean): Promise<void> {
  ;(await nodeHost()).setNodeHostControllerEnabled(id, enabled)
}

export async function removeController(id: string): Promise<void> {
  await (await nodeHost()).removeNodeHostController(id)
}

export async function startControllerQr(): Promise<string> {
  const d = required()
  const host = await nodeHost()
  return startControllerPairing({
    relayUrl: d.relayUrl(),
    desktopName: desktopName(),
    openSocket: openPairRoomSocket,
    ensureHost: host.ensureNodeHost,
    mintCode: host.mintNodePairingCode,
    emit: (event) => d.send(AgentIpcChannels.NODE_HOST_PAIRING_EVENT, event),
    ended: () => void host.reconcileNodeHost(),
  })
}

export async function confirmControllerQr(code: string): Promise<void> {
  const d = required()
  const host = await nodeHost()
  await confirmControllerPairing(code, {
    mintCode: host.mintNodePairingCode,
    emit: (event) => d.send(AgentIpcChannels.NODE_HOST_PAIRING_EVENT, event),
  })
}

export function cancelControllerQr(): void {
  cancelControllerPairing()
}

function pairingHost(host: EnvironmentHost): NodePairingHost {
  return {
    knownEnvironmentConnection: (environmentId) =>
      host.connections.listKnown().find((k) => k.environmentId === environmentId)?.connectionId ?? null,
    pairRemote: (input) => host.pairRemote(input),
    repairPairing: (input) => host.repairPairing(input),
  }
}

export async function startNodeQr(): Promise<string> {
  const d = required()
  const host = pairingHost(await d.environmentHost())
  return startNodePairingQr({
    relayUrl: d.relayUrl(),
    desktopName: desktopName(),
    openSocket: openPairRoomSocket,
    host,
    emit: (event) => d.send(AgentIpcChannels.ENVIRONMENT_NODE_PAIRING_EVENT, event),
  })
}

export function cancelNodeQr(): void {
  cancelNodePairingQr()
}

/** Pair a node from its code without a phone; development builds only (`desktop-node-lab`). */
export async function pairNodeCode(nodeCode: string): Promise<void> {
  await pairNodeFromCode(pairingHost(await required().environmentHost()), {
    nodeCode,
    nodeName: '',
    deviceLabel: desktopName(),
  })
}

export async function mintNodeCode(): Promise<string> {
  return (await nodeHost()).mintNodePairingCode()
}

/**
 * A phone paired with this computer carries a pairing to or from another
 * desktop. Its own pairing already lets it run anything here, so it may
 * grant control of this computer too; the person sees a notification.
 */
export async function handleDesktopPairCommand(
  command: { kind: 'mint'; controllerName: string } | { kind: 'pair'; nodeCode: string; nodeName: string },
): Promise<unknown> {
  if (!required().remoteNodesEnabled()) {
    throw new Error('Turn on remote nodes in SuperOne settings on this computer first')
  }
  if (command.kind === 'mint') {
    const nodeCode = await mintNodeCode()
    if (Notification.isSupported()) {
      new Notification({
        title: t('settings.remote.thisDevice.desktop.grantedTitle'),
        body: t('settings.remote.thisDevice.desktop.grantedBody', { name: command.controllerName }),
      }).show()
    }
    return { nodeCode }
  }
  await pairNodeFromCode(pairingHost(await required().environmentHost()), {
    nodeCode: command.nodeCode,
    nodeName: command.nodeName,
    deviceLabel: desktopName(),
  })
  return { ok: true }
}
