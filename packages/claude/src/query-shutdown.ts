/** Minimum control surface, including test streams without SDK methods. */
export interface ShutdownQuery {
  close?: () => void
  interrupt?: () => Promise<{ still_queued?: string[] } | undefined>
  cancelAsyncMessage?: (uuid: string) => Promise<boolean>
}

/** End input and drain exit notices before SDK close() discards its reader. */
export async function shutdownClaudeQuery(options: {
  query: ShutdownQuery | null
  endInput: () => void
  iterationDone: Promise<void>
  abort: () => void
  interrupt?: boolean
  timeoutMs?: number
}): Promise<void> {
  const { query } = options
  let timer: ReturnType<typeof setTimeout> | undefined
  let inputEnded = false
  const endInput = () => {
    if (!inputEnded) { inputEnded = true; options.endInput() }
  }
  try {
    const drain = async () => {
      if (options.interrupt && query?.interrupt) {
        let receipt: { still_queued?: string[] } | undefined
        try {
          receipt = await query.interrupt()
        } catch {
          // The process may already have exited. Its output still drains.
        }
        for (const id of receipt?.still_queued ?? []) {
          try {
            if (!await query.cancelAsyncMessage?.(id)) return
          } catch { return }
        }
      }
      endInput()
      await options.iterationDone.catch(() => undefined)
    }
    await Promise.race([
      drain(),
      // Native persistence flushes can themselves wait up to two seconds.
      new Promise<void>(resolve => { timer = setTimeout(resolve, options.timeoutMs ?? 3_000) }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
    endInput()
    try { query?.close?.() } catch { /* force teardown is best effort */ }
    options.abort()
  }
}
