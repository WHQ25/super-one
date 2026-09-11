import type { TerminalEvent } from '@superone/shared/agent-types'
import type { TerminalManager } from '../terminal/terminal-manager'

export interface TerminalTransport {
  sendTerminalFrame(event: TerminalEvent, targetDeviceIds?: string[]): Promise<void>
}

export class TerminalBroadcaster {
  constructor(
    private readonly terminalManager: TerminalManager,
    private readonly transport: TerminalTransport,
  ) {}

  async broadcast(event: TerminalEvent): Promise<void> {
    if (
      event.type === 'terminal_command_result' ||
      event.type === 'terminal_snapshot' ||
      event.type === 'terminal_snapshot_chunk'
    ) {
      return
    }
    // List metadata is not gated on subscribers of that PTY — every paired
    // phone needs create / close / title, even while watching another tab.
    if (
      event.type === 'terminal_title_changed'
      || event.type === 'terminal_created'
      || event.type === 'terminal_exited'
    ) {
      await this.transport.sendTerminalFrame(event)
      return
    }
    const session = this.terminalManager.get(event.terminalId)
    if (!session) return
    const ownership = session.ownership
    const targets = new Set<string>(ownership.subscribers)
    if (ownership.owner.kind === 'remote') targets.add(ownership.owner.deviceId)
    if (targets.size === 0) return

    if (event.type === 'terminal_owner_changed') {
      for (const deviceId of targets) {
        await this.transport.sendTerminalFrame(
          { ...event, writableByMe: event.ownerDeviceId === deviceId },
          [deviceId],
        )
      }
      return
    }
    await this.transport.sendTerminalFrame(event, [...targets])
  }
}
