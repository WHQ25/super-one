export async function waitForIceGathering(peer: RTCPeerConnection): Promise<void> {
  if (peer.iceGatheringState === 'complete') return
  await new Promise<void>((resolve, reject) => {
    let timeout = 0
    const onChange = (): void => {
      if (peer.iceGatheringState !== 'complete') return
      peer.removeEventListener('icegatheringstatechange', onChange)
      window.clearTimeout(timeout)
      resolve()
    }
    timeout = window.setTimeout(() => {
      peer.removeEventListener('icegatheringstatechange', onChange)
      reject(new Error('WebRTC ICE gathering timed out.'))
    }, 10_000)
    peer.addEventListener('icegatheringstatechange', onChange)
  })
}

export interface TcpIcePreferenceResult {
  sdp: string
  applied: boolean
  tcpCandidateCount: number
  fallbackCandidateCount: number
  reprioritizedCandidateCount: number
}

interface ParsedIceCandidate {
  lineIndex: number
  transport: string
  priority: number
  tokens: string[]
}

function parseIceCandidate(line: string, lineIndex: number): ParsedIceCandidate | null {
  if (!line.startsWith('a=candidate:')) return null
  const tokens = line.slice('a=candidate:'.length).trim().split(/\s+/)
  const transport = tokens[2]?.toLowerCase()
  const priority = Number(tokens[3])
  if (!transport || !Number.isSafeInteger(priority)) return null
  return { lineIndex, transport, priority, tokens }
}

/** Prefer TCP while retaining non-TCP candidates for automatic ICE fallback. */
export function preferTcpIceCandidates(sdp: string): TcpIcePreferenceResult {
  const newline = sdp.includes('\r\n') ? '\r\n' : '\n'
  const lines = sdp.split(/\r?\n/)
  const candidates = lines.flatMap((line, lineIndex) => {
    const candidate = parseIceCandidate(line, lineIndex)
    return candidate ? [candidate] : []
  })
  const tcpCandidates = candidates.filter((candidate) => candidate.transport === 'tcp')
  const fallbackCandidates = candidates.filter((candidate) => candidate.transport !== 'tcp')
  if (tcpCandidates.length === 0 || fallbackCandidates.length === 0) {
    return {
      sdp,
      applied: false,
      tcpCandidateCount: tcpCandidates.length,
      fallbackCandidateCount: fallbackCandidates.length,
      reprioritizedCandidateCount: 0,
    }
  }

  const byPriority = (left: ParsedIceCandidate, right: ParsedIceCandidate): number => right.priority - left.priority
  const rankedCandidates = [
    ...tcpCandidates.sort(byPriority),
    ...fallbackCandidates.sort(byPriority),
  ]
  const priorities = candidates.map((candidate) => candidate.priority).sort((left, right) => right - left)
  const assignedPriorities = new Map(
    rankedCandidates.map((candidate, index) => [candidate.lineIndex, priorities[index]]),
  )
  let reprioritizedCandidateCount = 0
  const preferredLines = lines.map((line, lineIndex) => {
    const candidate = parseIceCandidate(line, lineIndex)
    const priority = assignedPriorities.get(lineIndex)
    if (!candidate || priority === undefined || priority === candidate.priority) return line
    candidate.tokens[3] = String(priority)
    reprioritizedCandidateCount += 1
    return `a=candidate:${candidate.tokens.join(' ')}`
  })
  return {
    sdp: preferredLines.join(newline),
    applied: true,
    tcpCandidateCount: tcpCandidates.length,
    fallbackCandidateCount: fallbackCandidates.length,
    reprioritizedCandidateCount,
  }
}

const WEBRTC_DIAGNOSTIC_INTERVAL_MS = 2_000

interface CandidateStats extends RTCStats {
  candidateType?: RTCIceCandidateType
  protocol?: RTCIceProtocol
  relayProtocol?: RTCIceProtocol
}

interface InboundAudioCounters {
  id: string
  packetsReceived: number
  packetsLost: number
  concealedSamples: number
  totalSamplesReceived: number
}

export interface WebRtcDiagnosticSample {
  connectionState: RTCPeerConnectionState
  iceConnectionState: RTCIceConnectionState
  signalingState: RTCSignalingState
  inboundAudio: {
    packetsReceived: number
    packetsLost: number
    intervalPacketsReceived: number | null
    intervalPacketsLost: number | null
    intervalLossPercent: number | null
    jitterMs: number | null
    jitterBufferMeanDelayMs: number | null
    concealedSamples: number
    intervalConcealedSamples: number | null
    intervalConcealedSamplePercent: number | null
    concealmentEvents: number
  } | null
  candidatePair: {
    currentRoundTripTimeMs: number | null
    availableIncomingBitrateKbps: number | null
    localCandidateType: RTCIceCandidateType | null
    remoteCandidateType: RTCIceCandidateType | null
    protocol: RTCIceProtocol | null
    relayProtocol: RTCIceProtocol | null
  } | null
}

type DiagnosticTrace = (type: 'state' | 'stats' | 'stats_error', data: unknown) => void

function finite(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function rounded(value: number | null, digits = 2): number | null {
  if (value === null) return null
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}

function percentage(numerator: number, denominator: number): number | null {
  return denominator > 0 ? rounded((numerator / denominator) * 100) : null
}

function selectedCandidatePair(report: RTCStatsReport): RTCIceCandidatePairStats | null {
  let selectedId: string | undefined
  let nominated: RTCIceCandidatePairStats | null = null
  report.forEach((stats) => {
    if (stats.type === 'transport') {
      selectedId = (stats as RTCTransportStats).selectedCandidatePairId ?? selectedId
    }
    if (stats.type === 'candidate-pair') {
      const pair = stats as RTCIceCandidatePairStats
      if (pair.nominated && pair.state === 'succeeded') nominated = pair
    }
  })
  return (selectedId ? report.get(selectedId) as RTCIceCandidatePairStats | undefined : undefined) ?? nominated
}

function candidate(report: RTCStatsReport, id: string): CandidateStats | null {
  return (report.get(id) as CandidateStats | undefined) ?? null
}

function findStats<T extends RTCStats>(
  report: RTCStatsReport,
  predicate: (stats: RTCStats) => boolean,
): T | null {
  let found: T | null = null
  report.forEach((stats: RTCStats) => {
    if (!found && predicate(stats)) found = stats as T
  })
  return found
}

export function summarizeWebRtcStats(
  peer: RTCPeerConnection,
  report: RTCStatsReport,
  previous: InboundAudioCounters | null = null,
): { sample: WebRtcDiagnosticSample; counters: InboundAudioCounters | null } {
  const inbound = findStats<RTCInboundRtpStreamStats>(
    report,
    (stats) => stats.type === 'inbound-rtp' && (stats as RTCInboundRtpStreamStats).kind === 'audio',
  )

  const pair = selectedCandidatePair(report)
  const local = pair ? candidate(report, pair.localCandidateId) : null
  const remote = pair ? candidate(report, pair.remoteCandidateId) : null
  const counters = inbound ? {
    id: inbound.id,
    packetsReceived: inbound.packetsReceived ?? 0,
    packetsLost: inbound.packetsLost ?? 0,
    concealedSamples: inbound.concealedSamples ?? 0,
    totalSamplesReceived: inbound.totalSamplesReceived ?? 0,
  } : null
  const comparable = previous && counters?.id === previous.id ? previous : null
  const intervalPacketsReceived = comparable && counters
    ? Math.max(0, counters.packetsReceived - comparable.packetsReceived)
    : null
  const intervalPacketsLost = comparable && counters
    ? Math.max(0, counters.packetsLost - comparable.packetsLost)
    : null
  const intervalConcealedSamples = comparable && counters
    ? Math.max(0, counters.concealedSamples - comparable.concealedSamples)
    : null
  const intervalTotalSamples = comparable && counters
    ? Math.max(0, counters.totalSamplesReceived - comparable.totalSamplesReceived)
    : null
  const jitterBufferDelay = finite(inbound?.jitterBufferDelay)
  const jitterBufferEmittedCount = finite(inbound?.jitterBufferEmittedCount)
  const jitter = finite(inbound?.jitter)
  const currentRoundTripTime = finite(pair?.currentRoundTripTime)
  const availableIncomingBitrate = finite(pair?.availableIncomingBitrate)

  return {
    sample: {
      connectionState: peer.connectionState,
      iceConnectionState: peer.iceConnectionState,
      signalingState: peer.signalingState,
      inboundAudio: inbound && counters ? {
        packetsReceived: counters.packetsReceived,
        packetsLost: counters.packetsLost,
        intervalPacketsReceived,
        intervalPacketsLost,
        intervalLossPercent: intervalPacketsReceived !== null && intervalPacketsLost !== null
          ? percentage(intervalPacketsLost, intervalPacketsReceived + intervalPacketsLost)
          : null,
        jitterMs: rounded(jitter === null ? null : jitter * 1_000),
        jitterBufferMeanDelayMs: jitterBufferDelay !== null && jitterBufferEmittedCount !== null && jitterBufferEmittedCount > 0
          ? rounded((jitterBufferDelay / jitterBufferEmittedCount) * 1_000)
          : null,
        concealedSamples: counters.concealedSamples,
        intervalConcealedSamples,
        intervalConcealedSamplePercent: intervalConcealedSamples !== null && intervalTotalSamples !== null
          ? percentage(intervalConcealedSamples, intervalTotalSamples)
          : null,
        concealmentEvents: inbound.concealmentEvents ?? 0,
      } : null,
      candidatePair: pair ? {
        currentRoundTripTimeMs: rounded(currentRoundTripTime === null ? null : currentRoundTripTime * 1_000),
        availableIncomingBitrateKbps: rounded(availableIncomingBitrate === null ? null : availableIncomingBitrate / 1_000),
        localCandidateType: local?.candidateType ?? null,
        remoteCandidateType: remote?.candidateType ?? null,
        protocol: local?.protocol ?? remote?.protocol ?? null,
        relayProtocol: local?.relayProtocol ?? remote?.relayProtocol ?? null,
      } : null,
    },
    counters,
  }
}

/** Start development-only WebRTC telemetry. The caller controls whether this is enabled. */
export function startWebRtcDiagnostics(
  peer: RTCPeerConnection,
  trace: DiagnosticTrace,
  intervalMs = WEBRTC_DIAGNOSTIC_INTERVAL_MS,
): () => void {
  let stopped = false
  let collecting = false
  let previous: InboundAudioCounters | null = null

  const traceState = (): void => {
    trace('state', {
      connectionState: peer.connectionState,
      iceConnectionState: peer.iceConnectionState,
      iceGatheringState: peer.iceGatheringState,
      signalingState: peer.signalingState,
    })
  }
  const collect = async (): Promise<void> => {
    if (stopped || collecting || peer.connectionState === 'closed') return
    collecting = true
    try {
      const result = summarizeWebRtcStats(peer, await peer.getStats(), previous)
      previous = result.counters
      trace('stats', result.sample)
    } catch (error) {
      trace('stats_error', { message: error instanceof Error ? error.message : String(error) })
    } finally {
      collecting = false
    }
  }
  const onStateChange = (): void => {
    traceState()
    if (peer.connectionState === 'connected') void collect()
  }

  traceState()
  peer.addEventListener('connectionstatechange', onStateChange)
  peer.addEventListener('iceconnectionstatechange', onStateChange)
  peer.addEventListener('signalingstatechange', onStateChange)
  const interval = globalThis.setInterval(() => { void collect() }, intervalMs)

  return () => {
    stopped = true
    globalThis.clearInterval(interval)
    peer.removeEventListener('connectionstatechange', onStateChange)
    peer.removeEventListener('iceconnectionstatechange', onStateChange)
    peer.removeEventListener('signalingstatechange', onStateChange)
  }
}
