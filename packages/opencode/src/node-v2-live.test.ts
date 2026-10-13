import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import type { NodeSessionRecord } from '@superone/runtime/session'
import { createOpenCodeAppServerTurnRunner } from './run-turn'
import { startOpenCodeModelProvider, nativeModelFixtureConfig } from './testing/native-model-provider'

const binary = process.env.SUPERONE_OPENCODE_NATIVE_TEST_BINARY
describe('isolated native V2 node smoke', () => {
  it.skipIf(!binary)(
    'spawns authenticated private servers, resumes a native session across processes, and projects shell plus isolated model results',
    async () => {
      const root = realpathSync(mkdtempSync(join(tmpdir(), 'superone-node-v2-')))
      const provider = await startOpenCodeModelProvider('native shell reply')
      const env = {
        XDG_CONFIG_HOME: join(root, 'config'),
        XDG_DATA_HOME: join(root, 'data'),
        XDG_STATE_HOME: join(root, 'state'),
        XDG_CACHE_HOME: join(root, 'cache'),
        OPENCODE_CONFIG_CONTENT: JSON.stringify(nativeModelFixtureConfig(provider.baseUrl)),
        SUPERONE_FIXTURE_KEY: 'fixture-only-key',
      }
      const events: AgentEvent[] = []
      const session: NodeSessionRecord = {
        sessionId: 'host',
        projectId: 'p',
        harnessId: 'opencode',
        providerId: 'opencode',
        title: null,
        status: 'streaming',
        transcript: [],
        pendingInteraction: null,
        providerResume: null,
        cwd: root,
        createdAt: 0,
        updatedAt: 0,
        isPinned: false,
        isHidden: false,
        isUserRenamed: false,
        controllerClientSessionId: null,
        hostActionCapabilityVersion: 0,
        hostActionToolGroups: [],
        alwaysAllowedTools: [],
      }
      const runner = createOpenCodeAppServerTurnRunner(() => root, { binaryPath: binary, env })
      try {
        const first = await runner({
          session,
          text: '!printf native-node-first',
          messageId: 'first',
          onAgentEvent: (event) => events.push(event),
          onDelta: () => {},
          signal: new AbortController().signal,
        })
        expect(first.providerResume).toMatch(/^opencode:ses_/)
        expect(events).toContainEqual(
          expect.objectContaining({
            type: 'content_delta',
            messageId: 'first',
            delta: expect.objectContaining({ type: 'tool_result', summary: 'native-node-first' }),
          }),
        )
        const second = await runner({
          session: { ...session, providerResume: first.providerResume! },
          text: '!printf native-node-resumed',
          messageId: 'second',
          onAgentEvent: (event) => events.push(event),
          onDelta: () => {},
          signal: new AbortController().signal,
        })
        expect(second.providerResume).toBe(first.providerResume)
        expect(events.filter((event) => event.type === 'message_complete').map((event) => event.messageId)).toEqual([
          'first',
          'second',
        ])
        expect(events).toContainEqual(
          expect.objectContaining({
            type: 'content_delta',
            messageId: 'second',
            delta: expect.objectContaining({ type: 'tool_result', summary: 'native-node-resumed' }),
          }),
        )
      } finally {
        await provider.close()
        rmSync(root, { recursive: true, force: true })
      }
    },
    30000,
  )
})
