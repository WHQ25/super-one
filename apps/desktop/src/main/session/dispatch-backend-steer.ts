import type { BackendCommand, SessionBackend } from './types'

type SteerCommand = Extract<BackendCommand, {
  kind: 'codex.steer' | 'codex.steer_queued' | 'claude.steer_queued' | 'acp.steer_queued'
}>

/** Only accepted steering input belongs in the durable user transcript. */
export async function dispatchBackendSteer(cmd: SteerCommand, host: {
  id: string
  harnessId: string
  streaming: boolean
  backend: SessionBackend
  appendUserMessage: (id: string, text: string) => void
}): Promise<void> {
  if (cmd.kind !== 'codex.steer') {
    const [harness, label] = {
      'codex.steer_queued': ['codex', 'Codex'],
      'claude.steer_queued': ['claude', 'Claude'],
      'acp.steer_queued': ['acp', 'ACP'],
    }[cmd.kind]
    if (host.harnessId !== harness || !host.streaming) {
      throw new Error(`Queued message can only steer an active ${label} turn`)
    }
  }
  if (!host.backend.handleCommand) {
    throw new Error(`Session ${host.id} harness=${host.harnessId} does not support backend commands`)
  }
  await host.backend.handleCommand(cmd)
  if (cmd.kind === 'codex.steer' && cmd.newUserMessageId && cmd.newUserText) {
    host.appendUserMessage(cmd.newUserMessageId, cmd.newUserText)
  }
}
