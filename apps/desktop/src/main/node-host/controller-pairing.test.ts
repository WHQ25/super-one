import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ControllerPairingEvent } from '@superone/shared/agent-types'
import { DesktopPairRejectedError, parseDesktopPairQr, startControllerPairing as startPhone } from '@superone/relay-client/desktop-pair'
import { fakePairRoom } from '../../../../../packages/relay-client/src/test-pair-room'
import {
  cancelControllerPairing,
  confirmControllerPairing,
  controllerPairingOpen,
  startControllerPairing,
} from './controller-pairing'

vi.mock('../logger', () => ({ default: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} } }))

afterEach(() => cancelControllerPairing())

async function open() {
  const relay = fakePairRoom()
  const events: ControllerPairingEvent[] = []
  const ended = vi.fn()
  const ensureHost = vi.fn(async () => {})
  const mintCode = vi.fn(async () => 'superone-node:2:minted')
  const deps = {
    relayUrl: 'wss://relay.example',
    desktopName: 'Studio',
    openSocket: relay.open,
    ensureHost,
    mintCode,
    emit: (event: ControllerPairingEvent) => events.push(event),
    ended,
  }
  const qr = parseDesktopPairQr(await startControllerPairing(deps))
  relay.sockets.desktop!.onopen?.()
  const phone = startPhone({ qr, code: '246810', controllerName: 'MacBook', phoneName: 'iPhone', openSocket: relay.open })
  relay.sockets.mobile!.onopen?.()
  return { qr, phone, events, ended, ensureHost, mintCode, deps }
}

describe('controller QR', () => {
  it('starts the host, names this computer, and asks for the code the phone shows', async () => {
    const { qr, events, ensureHost } = await open()
    expect(ensureHost).toHaveBeenCalledOnce()
    expect(qr).toMatchObject({ kind: 'controller', desktopName: 'Studio' })
    expect(controllerPairingOpen()).toBe(true)
    expect(events).toEqual([{ type: 'request', controllerName: 'MacBook', phoneName: 'iPhone' }])
  })

  it('keeps the QR open after a wrong code and grants a node code after the right one', async () => {
    const { phone, events, mintCode, ended, deps } = await open()
    await expect(confirmControllerPairing('000000', deps)).rejects.toThrow('Incorrect pairing code')
    expect(mintCode).not.toHaveBeenCalled()
    await confirmControllerPairing('246810', deps)
    await expect(phone.done).resolves.toBe('superone-node:2:minted')
    expect(events.at(-1)).toEqual({ type: 'granted', controllerName: 'MacBook' })
    await vi.waitFor(() => expect(ended).toHaveBeenCalled())
    expect(controllerPairingOpen()).toBe(false)
  })

  it('tells the phone when the person cancels here', async () => {
    const { phone, ended } = await open()
    cancelControllerPairing()
    await expect(phone.done).rejects.toBeInstanceOf(DesktopPairRejectedError)
    await vi.waitFor(() => expect(ended).toHaveBeenCalled())
  })
})
