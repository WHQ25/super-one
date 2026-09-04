import { describe, expect, it, vi } from 'vitest'
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
})
