import type { KernelDisposer } from './types'

export function createDisposer(onDispose: () => void): KernelDisposer {
  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    onDispose()
  }
  return Object.assign(dispose, {
    dispose,
    [Symbol.dispose]: dispose,
  })
}
