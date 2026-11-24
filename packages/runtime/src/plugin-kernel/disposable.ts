export interface Disposable {
  dispose(): void
  [Symbol.dispose](): void
}

export interface DisposableScope extends Disposable {
  readonly disposed: boolean
  onDispose(fn: () => void): Disposable
  createChildScope(): DisposableScope
}

export function createDisposable(onDispose: () => void): Disposable {
  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    onDispose()
  }
  return {
    dispose,
    [Symbol.dispose]: dispose,
  }
}

export function createDisposableScope(): DisposableScope {
  let disposed = false
  const cleanups: Array<() => void> = []
  const children = new Set<DisposableScope>()

  const scope: DisposableScope = {
    get disposed() {
      return disposed
    },
    onDispose(fn: () => void): Disposable {
      if (disposed) {
        fn()
        return createDisposable(() => {})
      }
      cleanups.push(fn)
      return createDisposable(() => {
        const idx = cleanups.indexOf(fn)
        if (idx >= 0) cleanups.splice(idx, 1)
      })
    },
    createChildScope(): DisposableScope {
      const child = createDisposableScope()
      if (disposed) {
        child.dispose()
        return child
      }
      children.add(child)
      child.onDispose(() => {
        children.delete(child)
      })
      return child
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      for (const child of [...children]) {
        try {
          child.dispose()
        } catch (error) {
          console.error('[plugin-kernel] child scope dispose failed:', error)
        }
      }
      children.clear()
      for (const fn of [...cleanups].reverse()) {
        try {
          fn()
        } catch (error) {
          console.error('[plugin-kernel] disposer failed:', error)
        }
      }
      cleanups.length = 0
    },
    [Symbol.dispose](): void {
      scope.dispose()
    },
  }

  return scope
}
