import type { NodePairingEvent } from '@superone/shared/agent-types'
import type { PairRemoteInput, RepairPairingInput } from '@superone/shared/environment/client-view'
import {
  decodeNodePairingCode,
  nodePairingCodeLabel,
  nodePairingEndpointProfiles,
} from '@superone/shared/environment/node-pairing-code'
import {
  DESKTOP_PAIR_FRAMES,
  desktopPairQrUrl,
  type DesktopPairQr,
} from '@superone/relay-client/desktop-pair'
import {
  generatePairCode,
  joinPairRoom,
  newPairRoomKeys,
  type OpenPairRoomSocket,
  type PairRoom,
} from '@superone/relay-client/pair-room'
import log from '../logger'

/**
 * The controller side of desktop pairing through a phone: pair the node a
 * phone hands over, either from a node QR shown here ("Add Desktop") or a
 * `node_pair` command after the phone scanned the node's controller QR.
 * Contract: docs/architecture/remote-node-service.md §11.5.
 */

export interface NodePairingHost {
  knownEnvironmentConnection(environmentId: string): string | null
  pairRemote(input: PairRemoteInput): Promise<unknown>
  repairPairing(input: RepairPairingInput): Promise<unknown>
}

/**
 * Pair the node in a `superone-node:` code. A node paired before (removed
 * there, or its pairing lost) is re-paired in place, keeping its projects.
 */
export async function pairNodeFromCode(
  host: NodePairingHost,
  input: { nodeCode: string; nodeName: string; deviceLabel: string },
): Promise<void> {
  const code = decodeNodePairingCode(input.nodeCode, Date.now())
  const endpointProfiles = nodePairingEndpointProfiles(code)
  const connectionId = host.knownEnvironmentConnection(code.environmentId)
  log.info('[node-pairing] pairing node %s: %s', code.environmentId, connectionId ? `re-pair ${connectionId}` : 'new')
  if (connectionId) {
    await host.repairPairing({ connectionId, pairingToken: code.pairingToken, channel: code.channel, endpointProfiles })
    return
  }
  await host.pairRemote({
    environmentId: code.environmentId,
    endpointProfiles,
    pairingToken: code.pairingToken,
    label: input.nodeName.trim() || nodePairingCodeLabel(code),
    deviceLabel: input.deviceLabel || undefined,
    channel: code.channel,
  })
}

export interface NodeQrDeps {
  relayUrl: string
  desktopName: string
  openSocket: OpenPairRoomSocket
  host: NodePairingHost
  emit: (event: NodePairingEvent) => void
}

interface ActiveQr {
  room: PairRoom<void>
  nodeName: string | null
  cancelled: boolean
}

let active: ActiveQr | null = null

/**
 * Open a node QR, replacing one already open: a phone paired with the node
 * scans it, checks the code shown here, and hands over the node's code.
 */
export function startNodePairingQr(deps: NodeQrDeps): string {
  cancelNodePairingQr()
  const keys = newPairRoomKeys()
  const qr: DesktopPairQr = { kind: 'node', ...keys, relayUrl: deps.relayUrl, desktopName: deps.desktopName }
  const pairing: ActiveQr = { room: null as unknown as PairRoom<void>, nodeName: null, cancelled: false }
  let pairingStarted = false
  pairing.room = joinPairRoom<void>({
    relayUrl: qr.relayUrl,
    channelId: qr.channelId,
    tempKeyHex: qr.tempKeyHex,
    role: 'desktop',
    openSocket: deps.openSocket,
    onFrame: (frame, settle) => {
      if (frame.type === DESKTOP_PAIR_FRAMES.rejected) {
        settle({ ok: false, error: new Error('rejected') })
      } else if (frame.type === DESKTOP_PAIR_FRAMES.nodeOffer && pairing.nodeName === null) {
        const nodeName = typeof frame.body?.nodeName === 'string' ? frame.body.nodeName.trim() : ''
        const phoneName = typeof frame.body?.phoneName === 'string' ? frame.body.phoneName : ''
        pairing.nodeName = nodeName || 'Desktop'
        const code = generatePairCode()
        pairing.room.send(DESKTOP_PAIR_FRAMES.nodeChallenge, { code })
        deps.emit({ type: 'offer', code, nodeName: pairing.nodeName, phoneName })
      } else if (frame.type === DESKTOP_PAIR_FRAMES.nodeGrant && pairing.nodeName !== null && !pairingStarted) {
        const nodeCode = frame.body?.nodeCode
        if (typeof nodeCode !== 'string') return
        pairingStarted = true
        const nodeName = pairing.nodeName
        deps.emit({ type: 'pairing', nodeName })
        void pairNodeFromCode(deps.host, { nodeCode, nodeName, deviceLabel: deps.desktopName }).then(
          () => {
            pairing.room.send(DESKTOP_PAIR_FRAMES.nodeResult, { ok: true })
            log.info('[node-pairing] paired %s through a phone', nodeName)
            deps.emit({ type: 'paired', nodeName })
            settle({ ok: true, value: undefined })
          },
          (error: unknown) => {
            const message = error instanceof Error ? error.message : String(error)
            pairing.room.send(DESKTOP_PAIR_FRAMES.nodeResult, { ok: false, error: message })
            settle({ ok: false, error })
          },
        )
      }
    },
  })
  active = pairing
  pairing.room.done.catch((error: unknown) => {
    if (pairing.cancelled) return
    const message = error instanceof Error ? error.message : String(error)
    log.info('[node-pairing] node QR ended: %s', message)
    deps.emit({
      type: 'ended',
      reason: message === 'pairing timeout' ? 'expired' : message === 'rejected' ? 'rejected' : 'failed',
      message,
    })
  }).finally(() => {
    if (active === pairing) active = null
  })
  return desktopPairQrUrl(qr)
}

export function cancelNodePairingQr(): void {
  const pairing = active
  if (!pairing) return
  pairing.cancelled = true
  if (pairing.nodeName !== null) pairing.room.send(DESKTOP_PAIR_FRAMES.rejected)
  pairing.room.cancel()
  active = null
}
