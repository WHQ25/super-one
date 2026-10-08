import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import { frameRemotePayload } from '@superone/shared/remote-payload'
import { decodeHostPlaintext } from '@superone/relay-client/host-payload'
import { openLinkFrame } from '@superone/relay-client/phone-link'
import { acceptClientHello, issueChannelCredential, startClientHandshake, type SecureChannel } from '@superone/relay-client/secure-channel'

vi.mock('./remote-highlighter', () => ({
  initHighlighter: vi.fn(),
  highlightCodeSync: vi.fn(() => null),
  highlightCodeByLang: vi.fn(() => null),
  parseAnsiTokens: vi.fn(() => []),
}))
vi.mock('./logger', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }))
vi.mock('./agent/event-trace', () => ({ trace: vi.fn() }))

import { RemoteControlService } from './remote-control-service'
import * as phoneLink from './remote/phone-link-host'
import { RELAY_DRAFT_SAVE_INTERVAL_MS } from './remote/relay-draft-save-throttle'

describe('RemoteControlService draft saves', () => {
  afterEach(() => { vi.useRealTimers() })

  it('routes typing saves by each phone transport', async () => {
    vi.useFakeTimers()
    const sent: Array<{ text?: string; targets?: string[] }> = []
    const service = new RemoteControlService('wss://relay.example', { onCommand: vi.fn() })
    const internals = service as unknown as {
      keys: unknown
      hasAnyMobileTransport: () => boolean
      queueSend: (events: AgentEvent[], targets?: string[]) => void
      markDeviceOnline: (name: string, id: string, via: 'lan' | 'relay') => void
    }
    internals.keys = { rootSecret: 'ab'.repeat(32), channelKeyHex: 'cd'.repeat(32) }
    internals.hasAnyMobileTransport = () => true
    internals.queueSend = (events, targets) => {
      for (const event of events) if (event.type === 'draft_changed') sent.push({ text: event.draft?.text, targets })
    }
    internals.markDeviceOnline('Home phone', 'lan-phone', 'lan')
    internals.markDeviceOnline('Away phone', 'relay-phone', 'relay')

    const save = (text: string) => service.sendAgentEvent({ type: 'draft_changed', draftId: 'd1', reason: 'saved', draft: { id: 'd1', text } } as AgentEvent)
    await save('h')
    await save('hi')
    expect(sent).toEqual([{ text: 'h', targets: ['lan-phone'] }, { text: 'hi', targets: ['lan-phone'] }])

    vi.advanceTimersByTime(RELAY_DRAFT_SAVE_INTERVAL_MS)
    expect(sent.at(-1)).toEqual({ text: 'hi', targets: ['relay-phone'] })
    await service.stop()
  })
})

function channelPair() {
  const credential = issueChannelCredential('ab'.repeat(32), 'phone-key-0001')
  const c = startClientHandshake(credential)
  const s = acceptClientHello(c.hello, () => credential.secretHex)
  const { proof, channel: phone } = c.finish(s.challenge)
  return { phone, host: s.finish(proof) }
}

describe('RemoteControlService relay frames', () => {
  function makeService(devices: Record<string, Array<'lan' | 'relay'>>, channels: string[] = Object.keys(devices)) {
    const relayFrames: Array<{ type: string; targets?: string[]; data: string }> = []
    const lanFrames: Array<string[] | undefined> = []
    const phones = new Map<string, SecureChannel>()
    const relayLinks = new Map<string, { channel: SecureChannel | null }>()
    for (const id of channels) {
      const { phone, host } = channelPair()
      phones.set(id, phone)
      relayLinks.set(id, { channel: host })
    }
    const service = new RemoteControlService('wss://relay.example', { onCommand: vi.fn() })
    Object.assign(service, {
      relayWs: { readyState: WebSocket.OPEN, send: (frame: string) => relayFrames.push(JSON.parse(frame)) },
      lanServer: { sendFramed: (_kind: string, _framed: Uint8Array, targets?: string[]) => lanFrames.push(targets) },
      connectedDevices: new Map(Object.entries(devices).map(([id, via]) => [id, { name: id, transports: new Set(via) }])),
      relayLinks,
      phoneLink,
    })
    const framed = frameRemotePayload(new TextEncoder().encode('{"type":"x"}'))
    const send = (targets?: string[]) => (service as unknown as { sendEventFrame(framed: Uint8Array, targets?: string[]): void }).sendEventFrame(framed, targets)
    const open = (frame: { targets?: string[]; data: string }) => decodeHostPlaintext(openLinkFrame(phones.get(frame.targets![0]!)!, frame.data).payload)
    return { send, relayFrames, lanFrames, open }
  }

  it('skips the relay when no phone is on it', () => {
    const { send, relayFrames, lanFrames } = makeService({ home: ['lan'] }, [])
    send()
    send(['home'])
    expect(relayFrames).toEqual([])
    expect(lanFrames).toEqual([undefined, ['home']])
  })

  it('seals one copy per relay phone, each addressed to that phone alone', () => {
    const { send, relayFrames, open } = makeService({ home: ['lan'], away: ['relay'], far: ['relay'] })
    send()
    expect(relayFrames.map((frame) => [frame.type, frame.targets])).toEqual([['event', ['away']], ['event', ['far']]])
    expect(relayFrames.map(open)).toEqual([{ type: 'x' }, { type: 'x' }])
  })

  it('targets only phones without a LAN socket that hold a relay channel', () => {
    const { send, relayFrames } = makeService({ home: ['lan', 'relay'], away: ['relay'], offline: [] }, ['home', 'away'])
    send(['home', 'away', 'offline'])
    expect(relayFrames.map((frame) => frame.targets)).toEqual([['away']])
  })
})
