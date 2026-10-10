import type { TerminalEvent } from '@superone/shared/agent-types'
import type { PhoneTerminalTransport } from './mobile-broadcaster'

export interface TerminalTransport {
  sendTerminalFrame(event: TerminalEvent, targetDeviceIds?: string[]): Promise<void>
}

/** Terminal topics to phones: the hub picks the phones, this shapes each frame. */
export class TerminalBroadcaster implements PhoneTerminalTransport {
  constructor(private readonly transport: TerminalTransport) {}

  deliver(event: TerminalEvent, deviceIds: readonly string[]): void {
    // Answered to the asking device directly.
    if (
      event.type === 'terminal_command_result' ||
      event.type === 'terminal_snapshot' ||
      event.type === 'terminal_snapshot_chunk'
    ) {
      return
    }
    // List metadata (`terminalList`) reaches every phone, even while watching another tab.
    if (
      event.type === 'terminal_title_changed'
      || event.type === 'terminal_created'
      || event.type === 'terminal_exited'
      || event.type === 'terminal_control_changed'
    ) {
      void this.transport.sendTerminalFrame(event)
      return
    }
    if (deviceIds.length === 0) return
    if (event.type === 'terminal_owner_changed') {
      for (const deviceId of deviceIds) {
        void this.transport.sendTerminalFrame({ ...event, writableByMe: event.ownerDeviceId === deviceId }, [deviceId])
      }
      return
    }
    void this.transport.sendTerminalFrame(event, [...deviceIds])
  }
}
