import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NodePairingEvent } from '@superone/shared/agent-types'
import { encodeNodePairingCode } from '@superone/shared/environment/node-pairing-code'
import { DesktopPairRejectedError, parseDesktopPairQr, startNodePairing } from '@superone/relay-client/desktop-pair'
import { fakePairRoom } from '../../../../../packages/relay-client/src/test-pair-room'
import { cancelNodePairingQr, pairNodeFromCode, startNodePairingQr, type NodePairingHost } from './node-pairing'

vi.mock('../logger', () => ({ default: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} } }))

const CHANNEL = { keyId: 'tok_1', secretHex: 'e4'.repeat(32) }

function nodeCode(environmentId = 'env-studio'): string {
  return encodeNodePairingCode({
    environmentId,
    lan: { host: 'Studio.local', port: 7791 },
    relay: { url: 'wss://relay.example', room: '0f'.repeat(16) },
    pairingToken: 'pt_1',
    channel: CHANNEL,
    expiresAt: Date.now() + 60_000,
  })
}

function fakeHost(known: Record<string, string> = {}, fail?: Error) {
  const calls: Array<{ kind: 'pair' | 'repair'; input: unknown }> = []
  const host: NodePairingHost = {
    knownEnvironmentConnection: (environmentId) => known[environmentId] ?? null,
    pairRemote: async (input) => {
      calls.push({ kind: 'pair', input })
      if (fail) throw fail
    },
    repairPairing: async (input) => {
      calls.push({ kind: 'repair', input })
      if (fail) throw fail
    },
  }
  return { host, calls }
}

afterEach(() => cancelNodePairingQr())

describe('pairNodeFromCode', () => {
  it('pairs a new node under the name the phone knows it by', async () => {
    const { host, calls } = fakeHost()
    await pairNodeFromCode(host, { nodeCode: nodeCode(), nodeName: 'Studio', deviceLabel: 'MacBook' })
    expect(calls).toEqual([{
      kind: 'pair',
      input: expect.objectContaining({ environmentId: 'env-studio', label: 'Studio', deviceLabel: 'MacBook', channel: CHANNEL, pairingToken: 'pt_1' }),
    }])
  })

  it('re-pairs a node this computer already knows, keeping its connection', async () => {
    const { host, calls } = fakeHost({ 'env-studio': 'conn-1' })
    await pairNodeFromCode(host, { nodeCode: nodeCode(), nodeName: 'Studio', deviceLabel: 'MacBook' })
    expect(calls).toEqual([{ kind: 'repair', input: expect.objectContaining({ connectionId: 'conn-1', pairingToken: 'pt_1' }) }])
  })

  it('rejects text that is not a node code', async () => {
    const { host } = fakeHost()
    await expect(pairNodeFromCode(host, { nodeCode: 'hello', nodeName: '', deviceLabel: '' })).rejects.toThrow(/invalid pairing code/)
  })
})

describe('node QR', () => {
  function open(fail?: Error) {
    const relay = fakePairRoom()
    const events: NodePairingEvent[] = []
    const { host, calls } = fakeHost({}, fail)
    const qr = parseDesktopPairQr(startNodePairingQr({
      relayUrl: 'wss://relay.example',
      desktopName: 'MacBook',
      openSocket: relay.open,
      host,
      emit: (event) => events.push(event),
    }))
    relay.sockets.desktop!.onopen?.()
    const phone = startNodePairing({ qr, nodeName: 'Studio', phoneName: 'iPhone', openSocket: relay.open })
    relay.sockets.mobile!.onopen?.()
    return { phone, events, calls, relay }
  }

  it('shows a code, lets the phone check it, then pairs the node it hands over', async () => {
    const { phone, events, calls } = open()
    await phone.challenge
    const offer = events[0] as Extract<NodePairingEvent, { type: 'offer' }>
    expect(offer).toMatchObject({ type: 'offer', nodeName: 'Studio', phoneName: 'iPhone' })
    expect(phone.check(offer.code)).toBe(true)
    await phone.grant(nodeCode())
    expect(calls.map((c) => c.kind)).toEqual(['pair'])
    expect(events.map((e) => e.type)).toEqual(['offer', 'pairing', 'paired'])
  })

  it('tells the phone when pairing fails', async () => {
    const { phone, events } = open(new Error('request failed for http://Studio.local:7791'))
    await phone.challenge
    phone.check((events[0] as Extract<NodePairingEvent, { type: 'offer' }>).code)
    await expect(phone.grant(nodeCode())).rejects.toThrow(/request failed/)
    await vi.waitFor(() => expect(events.at(-1)).toMatchObject({ type: 'ended', reason: 'failed' }))
  })

  it('ends when the phone cancels, and the phone learns when this side cancels', async () => {
    const first = open()
    await first.phone.challenge
    first.phone.cancel()
    await vi.waitFor(() => expect(first.events.at(-1)).toMatchObject({ type: 'ended', reason: 'rejected' }))

    const second = open()
    await second.phone.challenge
    cancelNodePairingQr()
    await expect(second.phone.done).rejects.toBeInstanceOf(DesktopPairRejectedError)
  })
})
