import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  analyticsEnabled: true,
  fetch: vi.fn(async () => ({ ok: true })),
  warn: vi.fn(),
}))

vi.mock('electron', () => ({ app: { getVersion: () => '0.62.0-alpha' } }))
vi.mock('./app-settings-service', () => ({
  readAppSettings: () => ({ analyticsEnabled: mocks.analyticsEnabled }),
}))
vi.mock('./install-id', () => ({ getInstallId: () => 'install-abc' }))
vi.mock('./variant', () => ({ variantId: () => 'alpha' }))
vi.mock('./logger', () => ({
  default: { info: vi.fn(), warn: mocks.warn, debug: vi.fn(), error: vi.fn() },
}))

vi.stubGlobal('__POSTHOG_PROJECT_TOKEN__', 'test-key')
vi.stubGlobal('__POSTHOG_HOST__', '')
vi.stubGlobal('fetch', mocks.fetch)

import {
  _resetCrashTelemetryForTests,
  reportMainException,
  reportProcessGone,
} from './crash-telemetry'

function lastBody(): Record<string, unknown> {
  const init = mocks.fetch.mock.calls.at(-1)?.[1] as { body: string }
  return JSON.parse(init.body)
}

beforeEach(() => {
  mocks.fetch.mockClear()
  mocks.analyticsEnabled = true
  _resetCrashTelemetryForTests()
})

describe('reportMainException', () => {
  it('posts a $exception the Error Tracking UI can group, under the install id', async () => {
    const err = Object.assign(new TypeError('boom'), { code: 'EBOOM' })

    await reportMainException('uncaught_exception', err)

    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(mocks.fetch.mock.calls[0][0]).toBe('https://us.i.posthog.com/i/v0/e/')
    const body = lastBody()
    expect(body.api_key).toBe('test-key')
    expect(body.event).toBe('$exception')
    expect(body.distinct_id).toBe('install-abc')
    expect(body.properties).toMatchObject({
      app_version: '0.62.0-alpha',
      variant: 'alpha',
      platform: process.platform,
      process: 'main',
      kind: 'uncaught_exception',
      code: 'EBOOM',
      $exception_list: [{ type: 'TypeError', value: 'boom', mechanism: { handled: false, type: 'uncaught_exception' } }],
    })
    expect(typeof (body.properties as { stack: unknown }).stack).toBe('string')
  })

  it('copes with a non-Error rejection reason', async () => {
    await reportMainException('unhandled_rejection', 'just a string')

    expect((lastBody().properties as { $exception_list: Array<{ value: string }> }).$exception_list[0].value).toBe(
      'just a string',
    )
  })

  it('sends nothing when the user has analytics off', async () => {
    mocks.analyticsEnabled = false

    await reportMainException('uncaught_exception', new Error('x'))

    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('never throws into the crash handler when the network fails', async () => {
    mocks.fetch.mockRejectedValueOnce(new Error('offline'))

    await expect(reportMainException('uncaught_exception', new Error('x'))).resolves.toBeUndefined()
    expect(mocks.warn).toHaveBeenCalled()
  })

  it('caps the number of events per run so a crash loop cannot flood', async () => {
    for (let i = 0; i < 25; i++) await reportMainException('unhandled_rejection', new Error(`e${i}`))

    expect(mocks.fetch).toHaveBeenCalledTimes(20)
  })
})

describe('reportProcessGone', () => {
  it('reports a renderer crash with its role', async () => {
    await reportProcessGone('renderer', { reason: 'crashed', exitCode: 11 }, { role: 'main' })

    const body = lastBody()
    expect(body.event).toBe('process_gone')
    expect(body.properties).toMatchObject({ process: 'renderer', reason: 'crashed', exit_code: 11, role: 'main' })
  })

  it('ignores clean-exit, which is how utility processes normally end', async () => {
    await reportProcessGone('Utility', { reason: 'clean-exit', exitCode: 0, serviceName: 'network' })

    expect(mocks.fetch).not.toHaveBeenCalled()
  })
})
