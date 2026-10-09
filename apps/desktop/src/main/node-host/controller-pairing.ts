import type { ControllerPairingEvent } from '@superone/shared/agent-types'
import {
  DESKTOP_PAIR_FRAMES,
  desktopPairQrUrl,
  type DesktopPairQr,
} from '@superone/relay-client/desktop-pair'
import { joinPairRoom, newPairRoomKeys, type OpenPairRoomSocket, type PairRoom } from '@superone/relay-client/pair-room'
import log from '../logger'

/**
 * "Pair New Desktop" on the computer to be controlled: show a controller QR,
 * let a phone paired with the controller scan it, and grant a node pairing
 * code once the person here types the code the phone shows.
 * Contract: docs/architecture/remote-node-service.md §11.5.
 */

interface Pending {
  code: string
  controllerName: string
}

interface ActivePairing {
  room: PairRoom<void>
  pending: Pending | null
  /** Ended on purpose here; its end is not reported. */
  cancelled: boolean
}

export interface ControllerPairingDeps {
  relayUrl: string
  desktopName: string
  openSocket: OpenPairRoomSocket
  /** Brings the node host up for the controller to reach. */
  ensureHost: () => Promise<void>
  mintCode: () => Promise<string>
  emit: (event: ControllerPairingEvent) => void
  /** The room ended; the host may stop if nothing else needs it. */
  ended: () => void
}

let active: ActivePairing | null = null

export function controllerPairingOpen(): boolean {
  return active !== null
}

/** Open a controller QR, replacing one already open. Returns the QR text. */
export async function startControllerPairing(deps: ControllerPairingDeps): Promise<string> {
  cancelControllerPairing()
  await deps.ensureHost()
  const keys = newPairRoomKeys()
  const qr: DesktopPairQr = { kind: 'controller', ...keys, relayUrl: deps.relayUrl, desktopName: deps.desktopName }
  const pairing: ActivePairing = { room: null as unknown as PairRoom<void>, pending: null, cancelled: false }
  pairing.room = joinPairRoom<void>({
    relayUrl: qr.relayUrl,
    channelId: qr.channelId,
    tempKeyHex: qr.tempKeyHex,
    role: 'desktop',
    openSocket: deps.openSocket,
    onFrame: (frame, settle) => {
      if (frame.type === DESKTOP_PAIR_FRAMES.rejected) {
        settle({ ok: false, error: new Error('rejected') })
        return
      }
      if (frame.type !== DESKTOP_PAIR_FRAMES.controllerRequest || pairing.pending) return
      const code = frame.body?.code
      const controllerName = frame.body?.controllerName
      const phoneName = frame.body?.phoneName
      if (typeof code !== 'string' || !/^\d{6}$/.test(code) || typeof controllerName !== 'string') return
      pairing.pending = { code, controllerName: controllerName.trim() || 'Desktop' }
      deps.emit({
        type: 'request',
        controllerName: pairing.pending.controllerName,
        phoneName: typeof phoneName === 'string' ? phoneName : '',
      })
    },
  })
  active = pairing
  pairing.room.done.then(
    () => {},
    (error: unknown) => {
      if (pairing.cancelled) return
      const message = error instanceof Error ? error.message : String(error)
      log.info('[node-pairing] controller QR ended: %s', message)
      deps.emit({
        type: 'ended',
        reason: message === 'pairing timeout' ? 'expired' : message === 'rejected' ? 'rejected' : 'failed',
        message,
      })
    },
  ).finally(() => {
    if (active === pairing) active = null
    deps.ended()
  })
  return desktopPairQrUrl(qr)
}

/**
 * The person typed the phone's code. A wrong code throws and leaves the QR
 * open for another try.
 */
export async function confirmControllerPairing(
  enteredCode: string,
  deps: Pick<ControllerPairingDeps, 'mintCode' | 'emit'>,
): Promise<void> {
  const pairing = active
  if (!pairing?.pending) throw new Error('No pairing request received yet')
  if (pairing.pending.code !== enteredCode.trim()) throw new Error('Incorrect pairing code')
  const nodeCode = await deps.mintCode()
  pairing.room.send(DESKTOP_PAIR_FRAMES.controllerGrant, { nodeCode })
  log.info('[node-pairing] granted a node code to %s', pairing.pending.controllerName)
  deps.emit({ type: 'granted', controllerName: pairing.pending.controllerName })
  pairing.cancelled = true
  pairing.room.cancel()
}

export function cancelControllerPairing(): void {
  const pairing = active
  if (!pairing) return
  pairing.cancelled = true
  if (pairing.pending) pairing.room.send(DESKTOP_PAIR_FRAMES.rejected)
  pairing.room.cancel()
  active = null
}
