import { AsyncResource } from 'node:async_hooks'
import { describe, expect, it } from 'vitest'
import { acquirePhoneControl, controlLeaseAuthority } from '../control-lease.test-fixtures'
import { ScriptedBackend } from './backends/scripted-backend'
import { runFencedSessionControl, runWindowControl } from './control-context'
import { Session } from './session'
import type { BackendStartOptions } from './types'
import type { SessionLeaseAuthority } from './session-lease'

/** A runtime whose later callbacks (tool calls, hooks) run in the context it was started in, like a spawned SDK process. */
class RuntimeBackend extends ScriptedBackend {
  runtime: AsyncResource | null = null
  override async start(opts: BackendStartOptions): Promise<void> {
    this.runtime = new AsyncResource('test-runtime')
    await super.start(opts)
  }
}

function session(authority: SessionLeaseAuthority, id: string, backend = new ScriptedBackend('claude')): Session {
  return new Session({
    leaseAuthority: authority, id, projectPath: '/tmp/proj', cwd: '/tmp/proj',
    providerId: 'claude-base', harnessId: 'claude', providerConfig: {}, backend,
  })
}

describe('a runtime started by a frontend request', () => {
  it('does not carry a phone grant into host work the agent does later', async () => {
    const authority = controlLeaseAuthority()
    const backend = new RuntimeBackend('claude')
    const parent = session(authority, 'parent', backend)
    const child = session(authority, 'child')
    const proof = acquirePhoneControl(authority, 'parent', 'a')
    await runFencedSessionControl('parent', 'phone:a', proof, () => parent.send({ content: 'hi' }, { providerOrigin: 'remote' }))

    // e.g. session_collab_start sending the new child its task from a tool call
    expect(() => backend.runtime!.runInAsyncScope(() => child.lease.assertMutation())).not.toThrow()
  })

  it('does not take a window grant on sessions the agent touches later', async () => {
    const authority = controlLeaseAuthority()
    const backend = new RuntimeBackend('claude')
    const parent = session(authority, 'parent', backend)
    const child = session(authority, 'child')
    await runWindowControl(7, () => parent.send({ content: 'hi' }))

    backend.runtime!.runInAsyncScope(() => child.lease.assertMutation())
    expect(child.lease.current).toBeNull()
  })
})
