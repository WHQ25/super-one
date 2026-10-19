import { describe, expect, it, vi } from 'vitest'
import { SessionTransitionSupersededError } from './session-transition'
import { runUiAction } from './ui-action'

describe('runUiAction', () => {
  it('reports synchronous throws and asynchronous rejections', async () => {
    const onError = vi.fn()
    runUiAction(() => { throw new Error('send failed') }, onError)
    runUiAction(() => Promise.reject(new Error('rpc failed')), onError)
    await Promise.resolve()

    expect(onError).toHaveBeenNthCalledWith(1, 'send failed')
    expect(onError).toHaveBeenNthCalledWith(2, 'rpc failed')
  })

  it('uses the fallback for non-Error failures and ignores success', async () => {
    const onError = vi.fn()
    runUiAction(() => Promise.reject('offline'), onError, 'request failed')
    runUiAction(() => Promise.resolve(), onError)
    await Promise.resolve()

    expect(onError).toHaveBeenCalledOnce()
    expect(onError).toHaveBeenCalledWith('request failed')
  })

  it('hides a cancelled session switch and replaces an internal channel restart', async () => {
    const onError = vi.fn()
    runUiAction(() => { throw new SessionTransitionSupersededError() }, onError, 'failed to open session')
    runUiAction(() => Promise.reject(new Error('channel restarted')), onError, 'failed to open session')
    const aborted = new Error('aborted')
    aborted.name = 'AbortError'
    runUiAction(() => Promise.reject(aborted), onError, 'failed to open session')
    await Promise.resolve()

    expect(onError).toHaveBeenCalledOnce()
    expect(onError).toHaveBeenCalledWith('failed to open session')
  })
})
