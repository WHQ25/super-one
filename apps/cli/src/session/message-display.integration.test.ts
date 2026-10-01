import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createNodeSessionEventMapper } from '@superone/shared/node-session-event-map'
import { openNodeDatabase } from '../db/database'
import { EventLog } from './event-log'
import { ControlLeaseService } from './control-lease'
import { SessionRuntime, type TurnRunner } from './session-runtime'

describe('remote rich user message persistence', () => {
  it.each(['claude', 'codex'] as const)('keeps display chips separate from %s model input through restart and live events', async harness => {
    const directory = mkdtempSync(join(tmpdir(), 'message-display-'))
    const db = openNodeDatabase(join(directory, 'state.sqlite'))
    const events = new EventLog(db, 'node')
    const leases = new ControlLeaseService(db)
    let received: { text: string; images: unknown } | undefined
    const runner: TurnRunner = async ({ text, images }) => { received = { text, images }; return { finalText: 'done' } }
    let runtime = new SessionRuntime(db, events, leases, 'node', runner)
    try {
      const session = runtime.create({ projectId: 'project', harnessId: harness })
      const lease = leases.acquire({ resource: { environmentId: 'node', sessionId: session.sessionId }, holderClientId: 'client', ttlMs: 30_000 })
      const contexts = [{ appId: 'mcp:part', appName: 'CAD', summary: 'Dial', content: '{"part":"dial"}' }]
      const images = [{ id: 'image-1', name: 'Drawing', mimeType: 'image/png', base64: 'bytes' }]
      const display = [{ type: 'image' as const, name: 'Drawing', id: 'image-1' }]
      await runtime.send({ sessionId: session.sessionId, text: '{"part":"dial"}', images, contexts, userMessageContent: display, echoUserMessage: true, client: { clientSessionId: 'client' }, leaseId: lease.leaseId, generation: lease.generation })
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(received).toEqual({ text: '{"part":"dial"}', images })
      const mapper = createNodeSessionEventMapper({ sessionId: session.sessionId, projectPath: 'remote:node:project', skipUserMessage: true })
      const userEvent = events.listAfter('0').flatMap(event => mapper.map(event)).find(event => event.type === 'user_message_appended')
      expect(userEvent).toMatchObject({ message: { content: display, contexts, attachments: images } })
      await runtime.dispose()
      runtime = new SessionRuntime(db, events, leases, 'node', runner)
      const message = runtime.listMessages({ sessionId: session.sessionId }).messages[0]
      expect(message).toMatchObject({ content: display, contexts, attachments: images })
      expect(runtime.get(session.sessionId)?.transcript[0]).toMatchObject({ text: '{"part":"dial"}', userMessageContent: display, contexts, attachments: images })
    } finally { await runtime.dispose(); db.close(); rmSync(directory, { recursive: true, force: true }) }
  })
})
