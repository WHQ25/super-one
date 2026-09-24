import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AgentEvent } from '@superone/shared/agent-types'
import { DeepseekRuntime } from './runtime'
import type { DshPermissionPreset } from './permission-presets'
import { TEST_PRESET_OPTIONS } from './test-presets'
import { useToolCallAdapter } from './test-adapters'

const dirs: string[] = []
const disposers: Array<() => Promise<void>> = []

afterEach(async () => {
  while (disposers.length) await disposers.pop()?.().catch(() => undefined)
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

/**
 * A directory the sandbox must treat as OUTSIDE the workspace.
 *
 * It cannot live under `tmpdir()`: `workspace-write` grants the platform temp
 * areas as writable roots — the same set the Seatbelt profile grants — so a
 * sibling temp directory would be allowed and the test would prove nothing.
 * Removed in `afterEach` either way; if the sandbox fails, the file it should
 * never have created goes with it.
 */
function outsideDir(): string {
  const dir = mkdtempSync(join(homedir(), '.superone-dsh-sandbox-test-'))
  dirs.push(dir)
  return dir
}

function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-sandbox-'))
  dirs.push(dir)
  return dir
}

async function session(preset?: DshPermissionPreset) {
  const cwd = workspace()
  writeFileSync(join(cwd, 'seed.txt'), 'seed')

  const runtime = await DeepseekRuntime.create({ ...TEST_PRESET_OPTIONS, persona: 'test agent' })
  disposers.push(() => runtime.dispose())
  useToolCallAdapter(runtime)

  const events: AgentEvent[] = []
  const sessionId = randomUUID()
  const agent = await runtime.createAgent({
    sessionId,
    cwd,
    provider: 'mock',
    model: 'mock-1',
    onEvent: (event) => events.push(event),
    toolPlane: { requestPermission: vi.fn(async () => 'allowed-once' as const) },
  })
  disposers.push(() => agent.dispose())
  if (preset) runtime.setPermissionPreset(sessionId, preset)

  return {
    cwd,
    events,
    async run(text: string) {
      agent.sendText(text)
      await new Promise((resolve) => setTimeout(resolve, 50))
      await agent.whenIdle()
    },
  }
}

function results(events: AgentEvent[]): string {
  return events
    .filter((event) => event.type === 'content_delta' && event.delta.type === 'tool_result')
    .map((event) => JSON.stringify(event.type === 'content_delta' ? event.delta : {}))
    .join('\n')
}

describe('dsh sandbox — filesystem fence', () => {
  it('lets workspace-write write inside the project', async () => {
    const s = await session()

    await s.run('CALL write {"file_path":"inside.txt","content":"ok"}')

    expect(existsSync(join(s.cwd, 'inside.txt'))).toBe(true)
  })

  /**
   * The preset switch is a durable `sandbox/mode` event on the session's own
   * log, and `fs-sandbox` reads the effective mode per call — so the same tool
   * call that just succeeded must now be refused.
   */
  it('refuses a write inside the project under read-only', async () => {
    const s = await session('read-only')

    await s.run('CALL write {"file_path":"inside.txt","content":"ok"}')

    expect(existsSync(join(s.cwd, 'inside.txt'))).toBe(false)
    expect(results(s.events)).toMatch(/sandbox/i)
  })

  it('refuses a write outside the project under workspace-write', async () => {
    const outside = outsideDir()
    const s = await session()
    const target = join(outside, 'escaped.txt')

    await s.run(`CALL write {"file_path":"${target}","content":"ok"}`)

    expect(existsSync(target)).toBe(false)
  })

  it('allows the same write under danger-full-access', async () => {
    const outside = outsideDir()
    const s = await session('danger-full-access')
    const target = join(outside, 'escaped.txt')

    await s.run(`CALL write {"file_path":"${target}","content":"ok"}`)

    expect(existsSync(target)).toBe(true)
  })
})

describe('dsh sandbox — shell confinement', () => {
  /**
   * `bash` requires a `description` argument. Omitting it makes dsh reject the
   * call before the sandbox is consulted at all — an absent file then proves
   * nothing, which is exactly how the first cut of the negative test passed
   * without confining anything. Both tests assert the call actually ran.
   */
  const bashCall = (target: string) =>
    `CALL bash {"command":"echo hi > ${target}","description":"write outside"}`

  /**
   * The fs fence is a check in trusted code; this is the kernel one. On macOS
   * the command runs under Seatbelt, so the denial is a real EPERM from the
   * platform rather than a path comparison we performed.
   */
  it('confines bash to the workspace under workspace-write', async () => {
    const outside = outsideDir()
    const s = await session()
    const target = join(outside, 'shell-escaped.txt')

    await s.run(bashCall(target))

    expect(results(s.events)).not.toMatch(/invalid arguments/i)
    expect(existsSync(target)).toBe(false)
  })

  it('lets bash out under danger-full-access', async () => {
    const outside = outsideDir()
    const s = await session('danger-full-access')
    const target = join(outside, 'shell-escaped.txt')

    await s.run(bashCall(target))

    expect(results(s.events)).not.toMatch(/invalid arguments/i)
    expect(existsSync(target)).toBe(true)
  })
})
