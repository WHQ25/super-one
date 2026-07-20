import { describe, expect, it } from 'vitest'
import { parseArkVideoTask } from './response'

describe('parseArkVideoTask', () => {
  it('reads a submitted task as pending with its id', () => {
    expect(parseArkVideoTask({ id: 'cgt-1', status: 'queued' })).toEqual({
      id: 'cgt-1',
      status: 'queued',
      videoUrl: undefined,
      error: undefined,
    })
  })

  it('treats running as pending', () => {
    expect(parseArkVideoTask({ id: 'cgt-1', status: 'running' }).status).toBe('running')
  })

  it('surfaces the video url on success', () => {
    expect(
      parseArkVideoTask({ id: 'cgt-1', status: 'succeeded', content: { video_url: 'https://a/v.mp4' } }),
    ).toMatchObject({ status: 'succeeded', videoUrl: 'https://a/v.mp4' })
  })

  it('fails a succeeded task that carries no video url', () => {
    const parsed = parseArkVideoTask({ id: 'cgt-1', status: 'succeeded', content: {} })
    expect(parsed.status).toBe('failed')
    expect(parsed.error).toMatch(/no video url/i)
  })

  it('carries the upstream message on failure', () => {
    expect(parseArkVideoTask({ id: 'cgt-1', status: 'failed', error: { message: 'content filtered' } })).toMatchObject({
      status: 'failed',
      error: 'content filtered',
    })
  })

  it('falls back to a generic message when a failure carries none', () => {
    expect(parseArkVideoTask({ id: 'cgt-1', status: 'failed' }).error).toBeTruthy()
  })

  it('maps expired onto failed with an actionable message', () => {
    const parsed = parseArkVideoTask({ id: 'cgt-1', status: 'expired' })
    expect(parsed.status).toBe('failed')
    expect(parsed.error).toMatch(/expired/i)
  })

  it('keeps cancelled distinct from failed', () => {
    expect(parseArkVideoTask({ id: 'cgt-1', status: 'cancelled' }).status).toBe('cancelled')
  })

  it('fails loudly on an unrecognised status rather than polling forever', () => {
    const parsed = parseArkVideoTask({ id: 'cgt-1', status: 'wat' })
    expect(parsed.status).toBe('failed')
    expect(parsed.error).toMatch(/wat/)
  })
})
