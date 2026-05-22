export interface BridgeShutdownDeps {
  stdin: Pick<NodeJS.EventEmitter, 'on'>
  transport: { onclose?: (() => void) | undefined }
  ipc: { onClose: (() => void) | null }
  exit: () => void
}

export function wireBridgeShutdown(deps: BridgeShutdownDeps): void {
  let done = false
  const shutdown = (): void => {
    if (done) return
    done = true
    deps.exit()
  }
  deps.ipc.onClose = shutdown
  deps.transport.onclose = shutdown
  deps.stdin.on('end', shutdown)
  deps.stdin.on('close', shutdown)
}
