import { describe, expect, it, vi } from 'vitest'
import { preferTcpIceCandidates, startWebRtcDiagnostics, summarizeWebRtcStats } from './realtime-webrtc'

function statsReport(entries: Array<[string, RTCStats]>): RTCStatsReport {
  return new Map(entries) as unknown as RTCStatsReport
}

function peer(overrides: Partial<RTCPeerConnection> = {}): RTCPeerConnection {
  return {
    connectionState: 'connected',
    iceConnectionState: 'connected',
    iceGatheringState: 'complete',
    signalingState: 'stable',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    getStats: vi.fn(),
    ...overrides,
  } as unknown as RTCPeerConnection
}

describe('summarizeWebRtcStats', () => {
  it('reports interval audio loss, jitter, concealment, and selected route', () => {
    const current = statsReport([
      ['audio', {
        id: 'audio',
        type: 'inbound-rtp',
        timestamp: 2,
        kind: 'audio',
        packetsReceived: 190,
        packetsLost: 10,
        jitter: 0.024,
        jitterBufferDelay: 4,
        jitterBufferEmittedCount: 200,
        concealedSamples: 120,
        totalSamplesReceived: 9_600,
        concealmentEvents: 3,
      } as RTCInboundRtpStreamStats],
      ['transport', {
        id: 'transport',
        type: 'transport',
        timestamp: 2,
        selectedCandidatePairId: 'pair',
      } as RTCTransportStats],
      ['pair', {
        id: 'pair',
        type: 'candidate-pair',
        timestamp: 2,
        localCandidateId: 'local',
        remoteCandidateId: 'remote',
        transportId: 'transport',
        state: 'succeeded',
        currentRoundTripTime: 0.08,
        availableIncomingBitrate: 128_000,
      } as RTCIceCandidatePairStats],
      ['local', { id: 'local', type: 'local-candidate', timestamp: 2, candidateType: 'relay', protocol: 'udp', relayProtocol: 'udp' } as RTCStats],
      ['remote', { id: 'remote', type: 'remote-candidate', timestamp: 2, candidateType: 'host', protocol: 'udp' } as RTCStats],
    ])

    const result = summarizeWebRtcStats(peer(), current, {
      id: 'audio',
      packetsReceived: 100,
      packetsLost: 0,
      concealedSamples: 20,
      totalSamplesReceived: 4_800,
    })

    expect(result.sample.inboundAudio).toMatchObject({
      intervalPacketsReceived: 90,
      intervalPacketsLost: 10,
      intervalLossPercent: 10,
      jitterMs: 24,
      jitterBufferMeanDelayMs: 20,
      intervalConcealedSamples: 100,
      intervalConcealedSamplePercent: 2.08,
    })
    expect(result.sample.candidatePair).toEqual({
      currentRoundTripTimeMs: 80,
      availableIncomingBitrateKbps: 128,
      localCandidateType: 'relay',
      remoteCandidateType: 'host',
      protocol: 'udp',
      relayProtocol: 'udp',
    })
  })

  it('does not log candidate addresses or SDP', () => {
    const report = statsReport([
      ['pair', {
        id: 'pair',
        type: 'candidate-pair',
        timestamp: 1,
        localCandidateId: 'local',
        remoteCandidateId: 'remote',
        transportId: 'transport',
        state: 'succeeded',
        nominated: true,
      } as RTCIceCandidatePairStats],
      ['local', { id: 'local', type: 'local-candidate', timestamp: 1, address: '192.0.2.1', candidateType: 'host' } as RTCStats],
      ['remote', { id: 'remote', type: 'remote-candidate', timestamp: 1, address: '198.51.100.1', candidateType: 'host' } as RTCStats],
    ])

    const serialized = JSON.stringify(summarizeWebRtcStats(peer(), report).sample)
    expect(serialized).not.toContain('192.0.2.1')
    expect(serialized).not.toContain('198.51.100.1')
    expect(serialized).not.toContain('sdp')
  })
})

describe('preferTcpIceCandidates', () => {
  it('raises TCP priority while preserving UDP fallback and SDP framing', () => {
    const sdp = [
      'v=0',
      'm=audio 9 UDP/TLS/RTP/SAVPF 111',
      'a=candidate:udp 1 udp 2130706431 192.0.2.1 3478 typ host',
      'a=candidate:tcp 1 tcp 1671430143 192.0.2.1 443 typ host tcptype passive',
      'a=end-of-candidates',
      '',
    ].join('\r\n')

    const result = preferTcpIceCandidates(sdp)

    expect(result).toMatchObject({
      applied: true,
      tcpCandidateCount: 1,
      fallbackCandidateCount: 1,
      reprioritizedCandidateCount: 2,
    })
    expect(result.sdp).toContain('a=candidate:udp 1 udp 1671430143')
    expect(result.sdp).toContain('a=candidate:tcp 1 tcp 2130706431')
    expect(result.sdp).toContain('a=end-of-candidates\r\n')
  })

  it('keeps UDP candidates as a fallback when no TCP candidate is available', () => {
    const sdp = 'v=0\r\na=candidate:udp 1 udp 1 192.0.2.1 3478 typ host\r\n'
    expect(preferTcpIceCandidates(sdp)).toEqual({
      sdp,
      applied: false,
      tcpCandidateCount: 0,
      fallbackCandidateCount: 1,
      reprioritizedCandidateCount: 0,
    })
  })
})

describe('startWebRtcDiagnostics', () => {
  it('traces state immediately and removes listeners when stopped', () => {
    const connection = peer()
    const trace = vi.fn()

    const stop = startWebRtcDiagnostics(connection, trace, 60_000)
    expect(trace).toHaveBeenCalledWith('state', expect.objectContaining({
      connectionState: 'connected',
      iceConnectionState: 'connected',
    }))
    stop()

    expect(connection.removeEventListener).toHaveBeenCalledTimes(3)
  })
})
