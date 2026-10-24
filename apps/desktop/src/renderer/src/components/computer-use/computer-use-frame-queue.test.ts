import { describe, expect, it } from 'vitest'
import { createComputerUseFrameQueue } from './computer-use-frame-queue'

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  let reject: (error: unknown) => void = () => {}
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('computer use frame queue', () => {
  it('finishes the frame already decoding and then paints only the newest one', async () => {
    const started: string[] = []
    const gates = new Map<string, ReturnType<typeof deferred<void>>>()
    const queue = createComputerUseFrameQueue((data) => {
      started.push(data)
      const gate = deferred<void>()
      gates.set(data, gate)
      return gate.promise
    })

    queue.push('a')
    queue.push('b')
    queue.push('c')
    expect(started).toEqual(['a'])

    gates.get('a')?.resolve()
    await Promise.resolve()
    expect(started).toEqual(['a', 'c'])

    gates.get('c')?.resolve()
    await Promise.resolve()
    queue.close()
  })

  it('continues with a later frame when a decode fails', async () => {
    const started: string[] = []
    const gates = new Map<string, ReturnType<typeof deferred<void>>>()
    const queue = createComputerUseFrameQueue((data) => {
      started.push(data)
      const gate = deferred<void>()
      gates.set(data, gate)
      return gate.promise
    })

    queue.push('bad')
    queue.push('good')
    gates.get('bad')?.reject(new Error('decode failed'))
    await Promise.resolve()
    expect(started).toEqual(['bad', 'good'])
    gates.get('good')?.resolve()
    await Promise.resolve()
    queue.close()
  })
})
