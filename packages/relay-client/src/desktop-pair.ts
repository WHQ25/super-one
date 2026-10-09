import { readPairQr } from './pair'
import { joinPairRoom, type OpenPairRoomSocket, type PairRoom } from './pair-room'

/**
 * Pairing two desktops through a phone already paired with one of them. A
 * controller desktop (C) runs sessions on a controlled desktop (N); the
 * controlled side always confirms with a six-digit code. The node pairing code
 * (`superone-node:…`) N mints is the payload the phone carries between them.
 *
 * - `controller` QR, shown by N: the phone picks C, shows a code the person
 *   types on N, receives N's node code and hands it to C over its own link.
 * - `node` QR, shown by C: the phone picks N, checks the code C shows, asks N
 *   for a node code over its own link and hands it to C here.
 *
 * Contract: docs/architecture/remote-node-service.md §11.5.
 */

export type DesktopPairQrKind = 'controller' | 'node'

export interface DesktopPairQr {
  kind: DesktopPairQrKind
  channelId: string
  tempKeyHex: string
  relayUrl: string
  /** The desktop that shows the QR, for the phone to name it. */
  desktopName: string
}

const QR_HOST: Record<DesktopPairQrKind, string> = { controller: 'pair-controller', node: 'pair-node' }

export function desktopPairQrUrl(qr: DesktopPairQr): string {
  const params = new URLSearchParams({
    channel: qr.channelId,
    key: qr.tempKeyHex,
    relay: qr.relayUrl,
    name: qr.desktopName,
  })
  return `superone://${QR_HOST[qr.kind]}?${params.toString()}`
}

/** Which desktop-pairing QR this is, or null for any other text. */
export function desktopPairQrKind(raw: string): DesktopPairQrKind | null {
  const match = /^superone:\/\/(pair-controller|pair-node)(?:[/?#]|$)/i.exec(raw.trim())
  if (!match) return null
  return match[1].toLowerCase() === 'pair-controller' ? 'controller' : 'node'
}

export function parseDesktopPairQr(raw: string): DesktopPairQr {
  const kind = desktopPairQrKind(raw)
  if (!kind) throw new Error('not a SuperOne desktop pairing QR')
  const { params, channelId, tempKeyHex, relayUrl } = readPairQr(raw.trim(), QR_HOST[kind])
  return { kind, channelId, tempKeyHex, relayUrl, desktopName: (params.get('name') ?? '').trim() || 'Desktop' }
}

/** Frames of a desktop-pairing room; bodies are sealed under the QR key. */
export const DESKTOP_PAIR_FRAMES = {
  /** Controller QR, phone → N: `{ code, controllerName, phoneName }`. */
  controllerRequest: 'controller_request',
  /** Controller QR, N → phone: `{ nodeCode }`. */
  controllerGrant: 'controller_grant',
  /** Node QR, phone → C: `{ nodeName, phoneName }`. */
  nodeOffer: 'node_offer',
  /** Node QR, C → phone: `{ code }`, the code C shows. */
  nodeChallenge: 'node_challenge',
  /** Node QR, phone → C: `{ nodeCode }`. */
  nodeGrant: 'node_grant',
  /** Node QR, C → phone: `{ ok, error? }`. */
  nodeResult: 'node_result',
  /** Either side: the person declined or the desktop gave up. */
  rejected: 'desktop_pair_rejected',
} as const

export class DesktopPairRejectedError extends Error {
  constructor() {
    super('pairing rejected')
    this.name = 'DesktopPairRejectedError'
  }
}

/**
 * Controller QR, phone side: shows `code` for the person to type on N. `done`
 * resolves to the node code N grants once the code matched.
 */
export function startControllerPairing(opts: {
  qr: DesktopPairQr
  code: string
  controllerName: string
  phoneName: string
  openSocket: OpenPairRoomSocket
}): PairRoom<string> {
  return joinPairRoom<string>({
    relayUrl: opts.qr.relayUrl,
    channelId: opts.qr.channelId,
    tempKeyHex: opts.qr.tempKeyHex,
    role: 'mobile',
    openSocket: opts.openSocket,
    onOpen: (room) => room.send(DESKTOP_PAIR_FRAMES.controllerRequest, {
      code: opts.code,
      controllerName: opts.controllerName,
      phoneName: opts.phoneName,
    }),
    onFrame: (frame, settle) => {
      if (frame.type === DESKTOP_PAIR_FRAMES.rejected) settle({ ok: false, error: new DesktopPairRejectedError() })
      else if (frame.type === DESKTOP_PAIR_FRAMES.controllerGrant && typeof frame.body?.nodeCode === 'string') {
        settle({ ok: true, value: frame.body.nodeCode })
      }
    },
  })
}

export interface NodePairing {
  /** Resolves once C has shown its code. */
  challenge: Promise<void>
  /** Whether `typed` is the code C shows; the phone decides, not C. */
  check(typed: string): boolean
  /** Hand N's node code to C after `check` passed; resolves when C paired. */
  grant(nodeCode: string): Promise<void>
  cancel(): void
  /** Settles when the room ends: C's result, or why it ended. */
  done: Promise<void>
}

/**
 * Node QR, phone side. The phone confirms on N's behalf, so it compares the
 * code itself: C only says which code it shows, and a QR that is not C's own
 * produces a code nobody looking at C can type.
 */
export function startNodePairing(opts: {
  qr: DesktopPairQr
  nodeName: string
  phoneName: string
  openSocket: OpenPairRoomSocket
}): NodePairing {
  let shownCode: string | null = null
  let confirmed = false
  let announce!: () => void
  let fail!: (error: unknown) => void
  const challenge = new Promise<void>((resolve, reject) => {
    announce = resolve
    fail = reject
  })
  challenge.catch(() => {})
  const room = joinPairRoom<void>({
    relayUrl: opts.qr.relayUrl,
    channelId: opts.qr.channelId,
    tempKeyHex: opts.qr.tempKeyHex,
    role: 'mobile',
    openSocket: opts.openSocket,
    onOpen: (r) => r.send(DESKTOP_PAIR_FRAMES.nodeOffer, { nodeName: opts.nodeName, phoneName: opts.phoneName }),
    onFrame: (frame, settle) => {
      if (frame.type === DESKTOP_PAIR_FRAMES.rejected) {
        settle({ ok: false, error: new DesktopPairRejectedError() })
      } else if (frame.type === DESKTOP_PAIR_FRAMES.nodeChallenge && shownCode === null) {
        const code = frame.body?.code
        if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return
        shownCode = code
        announce()
      } else if (frame.type === DESKTOP_PAIR_FRAMES.nodeResult && confirmed) {
        if (frame.body?.ok === true) settle({ ok: true, value: undefined })
        else settle({ ok: false, error: new Error(typeof frame.body?.error === 'string' ? frame.body.error : 'pairing failed') })
      }
    },
  })
  room.done.catch((error) => fail(error))
  return {
    challenge,
    check(typed) {
      if (shownCode === null) return false
      confirmed = typed.trim() === shownCode
      return confirmed
    },
    grant(nodeCode) {
      if (!confirmed) return Promise.reject(new Error('the code was not confirmed'))
      room.send(DESKTOP_PAIR_FRAMES.nodeGrant, { nodeCode })
      return room.done
    },
    cancel() {
      room.send(DESKTOP_PAIR_FRAMES.rejected)
      room.cancel()
    },
    done: room.done,
  }
}
