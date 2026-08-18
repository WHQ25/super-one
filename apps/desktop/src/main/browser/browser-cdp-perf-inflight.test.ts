import { describe, it, expect } from 'vitest'
import { createInFlightLedger, isStreamingResponse } from './browser-cdp-perf-inflight'

// Real pages keep connections open forever (SSE, media streams, long-poll).
// Observed on threejs.org: 4 requests never emitted loadingFinished across a
// 10s window, pinning inFlight at 4 and making settle unreachable.
describe('in-flight accounting', () => {
  it('counts a request that has started but not finished', () => {
    const l = createInFlightLedger()
    l.started('a', 1000)
    expect(l.count(1100)).toBe(1)
  })

  it('stops counting a request once it finishes', () => {
    const l = createInFlightLedger()
    l.started('a', 1000)
    l.settled('a')
    expect(l.count(1100)).toBe(0)
  })

  it('stops counting a request once it fails', () => {
    const l = createInFlightLedger()
    l.started('a', 1000)
    l.settled('a')
    expect(l.count(1100)).toBe(0)
  })

  it('keeps counting a slow finite request past five seconds', () => {
    const l = createInFlightLedger()
    l.started('slow-api', 1000, 'https://x.test/api/report', 'Fetch')
    expect(l.count(1000 + 8000)).toBe(1)
  })

  it('excludes a request whose resource type proves it is long-lived', () => {
    const l = createInFlightLedger()
    l.started('events', 1000, 'https://x.test/events', 'EventSource')
    expect(l.count(10_000)).toBe(0)
    expect(l.streamingCount()).toBe(1)
  })

  it('excludes a fetch once its response proves it is an event stream', () => {
    const l = createInFlightLedger()
    l.started('events', 1000, 'https://x.test/events', 'Fetch')
    expect(l.count(1100)).toBe(1)
    l.markStreaming('events')
    expect(l.count(1100)).toBe(0)
    expect(l.streamingCount()).toBe(1)
  })

  // Connections opened during pre-settle/baseline belong to the page, not the
  // action, and must never hold the action's window open.
  it('ignores requests that were already open before the action was marked', () => {
    const l = createInFlightLedger()
    l.started('ambient', 1000)
    l.mark(2000)
    expect(l.count(2100)).toBe(0)
  })

  it('counts requests started after the mark', () => {
    const l = createInFlightLedger()
    l.mark(2000)
    l.started('fresh', 2100)
    expect(l.count(2200)).toBe(1)
  })

  it('ignores a request started immediately before mark even at the same millisecond', () => {
    const l = createInFlightLedger()
    l.started('setup', 2000)
    l.mark(2000)
    expect(l.count(2000)).toBe(0)
  })

  it('resets the seen-url history on mark so a stale url cannot satisfy until', () => {
    const l = createInFlightLedger()
    l.started('a', 1000, 'https://x.test/api/search')
    l.mark(2000)
    expect(l.sawUrl('/api/search')).toBe(false)
  })

  it('reports a url seen after the mark', () => {
    const l = createInFlightLedger()
    l.mark(2000)
    l.started('a', 2100, 'https://x.test/api/search')
    expect(l.sawUrl('/api/search')).toBe(false)
    l.settled('a')
    expect(l.sawUrl('/api/search')).toBe(true)
  })

  it('does not report an open event stream as a completed until url', () => {
    const l = createInFlightLedger()
    l.mark(2000)
    l.started('events', 2100, 'https://x.test/api/events', 'EventSource')
    expect(l.sawUrl('/api/events')).toBe(false)
  })

  it('counts only post-mark requests in the total', () => {
    const l = createInFlightLedger()
    l.started('ambient', 1000)
    l.mark(2000)
    l.started('a', 2100)
    l.started('b', 2200)
    expect(l.total()).toBe(2)
  })

  it('reports how many action requests were explicitly classified as streaming', () => {
    const l = createInFlightLedger()
    l.mark(1000)
    l.started('stream', 1100, 'https://x.test/events', 'Fetch')
    l.markStreaming('stream')
    expect(l.streamingCount()).toBe(1)
  })
})

describe('streaming response classification', () => {
  it('recognises event streams from MIME metadata even when CDP reports Fetch', () => {
    expect(isStreamingResponse('Fetch', 'text/event-stream')).toBe(true)
    expect(isStreamingResponse('Fetch', undefined, { 'Content-Type': 'text/event-stream; charset=utf-8' })).toBe(true)
  })

  it('does not classify an old JSON request as streaming just because it is slow', () => {
    expect(isStreamingResponse('Fetch', 'application/json', { 'content-type': 'application/json' })).toBe(false)
  })
})
