import { describe, expect, it } from 'vitest'
import { sessionCreationOptions } from './navigation/session-creation-options'
import { ChatRuntime } from './runtime'
import { runtimeTestClient } from './runtime-test-client'

describe('Codex Fast selected before creating a mobile session', () => {
  it.each([{ serviceTier: 'priority' }, { serviceTier: null }])(
    'carries the landing selection through session.create (serviceTier=$serviceTier)',
    async ({ serviceTier }) => {
      const client = runtimeTestClient()
      const runtime = new ChatRuntime(client as never, () => {})
      // Keep the picked tier in the input even before the creation contract
      // supports it, so this regression runs without changing production types.
      const landing = {
        provider: 'codex', acpAgentId: null, permissionMode: 'auto',
        model: 'gpt-6.1-sol', effort: 'xhigh', serviceTier,
        worktree: { kind: 'local' }, directories: [], sandboxMode: null,
        modeId: null, apiProviderId: null,
      } satisfies Parameters<typeof sessionCreationOptions>[0] & { serviceTier: string | null }

      try {
        await runtime.create('/project', { sessionId: 'session', ...sessionCreationOptions(landing) })

        expect(client.sent.find((call) => call.method === 'session.create')).toMatchObject({
          harnessId: 'codex', model: landing.model, effort: landing.effort, serviceTier,
        })
      } finally {
        runtime.dispose()
      }
    },
  )
})
