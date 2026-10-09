import { describe, expect, it } from 'vitest'
import {
  DESKTOP_PAIR_FRAMES,
  DesktopPairRejectedError,
  desktopPairQrKind,
  desktopPairQrUrl,
  parseDesktopPairQr,
  startControllerPairing,
  startNodePairing,
  type DesktopPairQr,
} from './desktop-pair'
import { joinPairRoom } from './pair-room'
import { fakePairRoom } from './test-pair-room'

const KEY = 'ab'.repeat(32)

function qr(kind: DesktopPairQr['kind']): DesktopPairQr {
  return { kind, channelId: 'c0ffee', tempKeyHex: KEY, relayUrl: 'wss://relay.example', desktopName: 'Studio' }
}

describe('desktop pairing QR', () => {
  it('round-trips both kinds and names the desktop', () => {
    for (const kind of ['controller', 'node'] as const) {
      const url = desktopPairQrUrl(qr(kind))
      expect(desktopPairQrKind(url)).toBe(kind)
      expect(parseDesktopPairQr(url)).toEqual(qr(kind))
    }
  })

  it('tells desktop pairing QRs apart from phone pairing and other text', () => {
    expect(desktopPairQrKind(`superone://pair?channel=a&key=${KEY}&deviceId=d&relay=wss://r`)).toBeNull()
    expect(desktopPairQrKind('superone-node:2:abc')).toBeNull()
    expect(() => parseDesktopPairQr('superone://pair-node?channel=a&key=bad&relay=wss://r')).toThrow(/key is invalid/)
    expect(() => parseDesktopPairQr(`superone://pair-node?channel=a&key=${KEY}&relay=https://r`)).toThrow(/ws or wss/)
  })
})

describe('controller QR', () => {
  it('delivers the node code once the controlled desktop accepts the code', async () => {
    const relay = fakePairRoom()
    let request: Record<string, unknown> | undefined
    const desktop = joinPairRoom<void>({
      ...qr('controller'),
      role: 'desktop',
      openSocket: relay.open,
      onFrame: (frame, settle) => {
        if (frame.type !== DESKTOP_PAIR_FRAMES.controllerRequest) return
        request = frame.body
        desktop.send(DESKTOP_PAIR_FRAMES.controllerGrant, { nodeCode: 'superone-node:2:xyz' })
        settle({ ok: true, value: undefined })
      },
    })
    relay.sockets.desktop!.onopen?.()
    const phone = startControllerPairing({
      qr: qr('controller'), code: '123456', controllerName: 'MacBook', phoneName: 'iPhone', openSocket: relay.open,
    })
    relay.sockets.mobile!.onopen?.()
    await expect(phone.done).resolves.toBe('superone-node:2:xyz')
    expect(request).toEqual({ code: '123456', controllerName: 'MacBook', phoneName: 'iPhone' })
    expect(relay.sockets.mobile!.closed).toBe(true)
  })

  it('fails when the controlled desktop declines', async () => {
    const relay = fakePairRoom()
    const desktop = joinPairRoom<void>({
      ...qr('controller'), role: 'desktop', openSocket: relay.open,
      onFrame: () => desktop.send(DESKTOP_PAIR_FRAMES.rejected),
    })
    relay.sockets.desktop!.onopen?.()
    const phone = startControllerPairing({
      qr: qr('controller'), code: '123456', controllerName: 'MacBook', phoneName: 'iPhone', openSocket: relay.open,
    })
    relay.sockets.mobile!.onopen?.()
    await expect(phone.done).rejects.toBeInstanceOf(DesktopPairRejectedError)
  })
})

describe('node QR', () => {
  function controllerDesktop(relay: ReturnType<typeof fakePairRoom>, result: { ok: boolean; error?: string }) {
    const granted: string[] = []
    const desktop = joinPairRoom<void>({
      ...qr('node'), role: 'desktop', openSocket: relay.open,
      onFrame: (frame, settle) => {
        if (frame.type === DESKTOP_PAIR_FRAMES.nodeOffer) desktop.send(DESKTOP_PAIR_FRAMES.nodeChallenge, { code: '654321' })
        if (frame.type === DESKTOP_PAIR_FRAMES.nodeGrant) {
          granted.push(String(frame.body?.nodeCode))
          desktop.send(DESKTOP_PAIR_FRAMES.nodeResult, result)
          settle({ ok: true, value: undefined })
        }
      },
    })
    relay.sockets.desktop!.onopen?.()
    return granted
  }

  it('checks the shown code on the phone before granting', async () => {
    const relay = fakePairRoom()
    const granted = controllerDesktop(relay, { ok: true })
    const phone = startNodePairing({ qr: qr('node'), nodeName: 'Studio', phoneName: 'iPhone', openSocket: relay.open })
    relay.sockets.mobile!.onopen?.()
    await phone.challenge
    await expect(phone.grant('superone-node:2:early')).rejects.toThrow(/not confirmed/)
    expect(phone.check('000000')).toBe(false)
    expect(phone.check(' 654321 ')).toBe(true)
    await expect(phone.grant('superone-node:2:xyz')).resolves.toBeUndefined()
    expect(granted).toEqual(['superone-node:2:xyz'])
  })

  it('reports the controller desktop failing to pair', async () => {
    const relay = fakePairRoom()
    controllerDesktop(relay, { ok: false, error: 'node unreachable' })
    const phone = startNodePairing({ qr: qr('node'), nodeName: 'Studio', phoneName: 'iPhone', openSocket: relay.open })
    relay.sockets.mobile!.onopen?.()
    await phone.challenge
    phone.check('654321')
    await expect(phone.grant('superone-node:2:xyz')).rejects.toThrow('node unreachable')
  })

  it('ignores a challenge sealed under another key', async () => {
    const relay = fakePairRoom()
    const stranger = joinPairRoom<void>({
      ...qr('node'), tempKeyHex: 'cd'.repeat(32), role: 'desktop', openSocket: relay.open,
      onFrame: () => stranger.send(DESKTOP_PAIR_FRAMES.nodeChallenge, { code: '111111' }),
    })
    relay.sockets.desktop!.onopen?.()
    const phone = startNodePairing({ qr: qr('node'), nodeName: 'Studio', phoneName: 'iPhone', openSocket: relay.open })
    relay.sockets.mobile!.onopen?.()
    phone.cancel()
    await expect(phone.challenge).rejects.toThrow(/cancelled/)
    expect(phone.check('111111')).toBe(false)
  })
})
