import { describe, expect, it, vi } from 'vitest'
import type { ModRenderResult, ModUiOp } from '@superone/shared/mod-ui'
import { ModUiClient, type ModUiTransport } from './client'

const tick = () => new Promise((r) => setTimeout(r, 5))

function setup(render: (req: { component: string; instanceId: string; props: Record<string, unknown> }) => ModRenderResult, overrides: Partial<Record<ModUiOp, unknown>> = {}) {
  const calls: Array<{ op: ModUiOp; request: unknown }> = []
  const transport = vi.fn(async (op: ModUiOp, request: unknown) => {
    calls.push({ op, request })
    if (op in overrides) return overrides[op]
    if (op === 'attach') return { surfaces: ['desktop'] }
    if (op === 'panes') return { panes: [], shownId: null, focusedId: null, focusRequestedId: null }
    if (op === 'render') return render(request as never)
    if (op === 'hostReply') return { accepted: true }
    return {}
  }) as unknown as ModUiTransport
  const client = new ModUiClient({ transport, surface: 'desktop', clientId: 'test', hostHandler: async () => ({ kind: 'copy', copied: true }) })
  return { client, calls, renders: () => calls.filter((c) => c.op === 'render') }
}

const UNHOOKED: ModRenderResult = { tree: { type: 'engine', ref: 0 }, props: {}, hooked: false }

describe('ModUiClient', () => {
  it('asks once per unhooked component however many rows mount (performance gate)', async () => {
    const { client, renders } = setup(() => UNHOOKED)
    await client.attach()
    for (let i = 0; i < 500; i++) client.observe('UserMessage', `m${i}`, { text: `row ${i}` }, {}, () => {})
    await tick()
    expect(renders()).toHaveLength(1)
    for (let i = 0; i < 500; i++) client.update('UserMessage', `m${i}`, { text: `edited ${i}` }, {})
    await tick()
    expect(renders()).toHaveLength(1)
  })

  it('asks every mounted row once a component turns out hooked', async () => {
    const { client, renders } = setup(() => ({ tree: { type: 'Text', children: ['x'] }, props: {}, hooked: true }))
    await client.attach()
    for (let i = 0; i < 5; i++) client.observe('ToolUse', `t${i}`, { tool: 'Bash' }, {}, () => {})
    await tick()
    await tick()
    expect(renders()).toHaveLength(5)
  })

  it('stays at zero asks while the session draws no mods', async () => {
    const { client, renders } = setup(() => UNHOOKED)
    for (let i = 0; i < 50; i++) client.observe('ToolUse', `t${i}`, { tool: 'Bash' }, {}, () => {})
    await tick()
    expect(renders()).toHaveLength(0)
  })

  it('re-asks a hooked site only when its props change', async () => {
    const { client, renders } = setup(() => ({ tree: { type: 'Text', children: ['hi'] }, props: {}, hooked: true }))
    await client.attach()
    client.observe('AbovePrompt', 'above-prompt', { isWorking: false }, {}, () => {})
    await tick()
    client.update('AbovePrompt', 'above-prompt', { isWorking: false }, {})
    await tick()
    expect(renders()).toHaveLength(1)
    client.update('AbovePrompt', 'above-prompt', { isWorking: true }, {})
    await tick()
    expect(renders()).toHaveLength(2)
    expect(client.snapshot('AbovePrompt', 'above-prompt').status).toBe('ready')
  })

  it('an un-narrowed invalidate asks unhooked components again', async () => {
    const { client, renders } = setup(() => UNHOOKED)
    await client.attach()
    client.observe('ToolGroup', 'g1', { calls: [] }, {}, () => {})
    await tick()
    expect(renders()).toHaveLength(1)
    client.handleEvent({ type: 'mod_invalidate' } as never)
    await tick()
    expect(renders()).toHaveLength(2)
  })

  it('a narrowed invalidate re-asks only its own surface’s instances', async () => {
    const { client, renders } = setup(() => ({ tree: { type: 'Text', children: ['x'] }, props: {}, hooked: true }))
    await client.attach()
    client.observe('Pane', 'a', {}, {}, () => {})
    client.observe('Pane', 'b', {}, {}, () => {})
    await tick()
    const before = renders().length
    client.handleEvent({ type: 'mod_invalidate', instances: [{ surface: 'desktop', component: 'Pane', instanceId: 'a' }, { surface: 'mobile', component: 'Pane', instanceId: 'b' }] } as never)
    await tick()
    expect(renders().slice(before).map((c) => (c.request as { instanceId: string }).instanceId)).toEqual(['a'])
  })

  it('answers a host request addressed to this client and ignores others', async () => {
    const { client, calls } = setup(() => UNHOOKED)
    await client.attach()
    client.handleEvent({ type: 'mod_host_request', clientId: 'other', requestId: 'r0', request: { kind: 'copy', plugin: 'p', text: 'x' } } as never)
    client.handleEvent({ type: 'mod_host_request', clientId: 'test', requestId: 'r1', request: { kind: 'copy', plugin: 'p', text: 'x' } } as never)
    await tick()
    expect(calls.filter((c) => c.op === 'hostReply').map((c) => c.request)).toEqual([{ requestId: 'r1', clientId: 'test', reply: { kind: 'copy', copied: true } }])
  })

  it('turns every site off when the session stops drawing mods', async () => {
    const { client } = setup(() => ({ tree: { type: 'Text', children: ['x'] }, props: {}, hooked: true }))
    await client.attach()
    client.observe('Pane', 'p', {}, {}, () => {})
    await tick()
    client.handleEvent({ type: 'mod_ui_state', available: false } as never)
    expect(client.snapshot('Pane', 'p').status).toBe('off')
    expect(client.getState().available).toBe(false)
    expect(await client.act('press', { plugin: 'p', handle: 1, surface: 'desktop', clientId: 'test' })).toBeNull()
  })

  it('drops an answer that arrives after the session stopped drawing mods', async () => {
    let answer!: (r: ModRenderResult) => void
    const { client } = setup(() => new Promise<ModRenderResult>((r) => (answer = r)) as never)
    await client.attach()
    client.observe('Pane', 'p', {}, {}, () => {})
    await tick()
    expect(client.snapshot('Pane', 'p').status).toBe('pending')
    client.reset()
    answer({ tree: { type: 'Text', children: ['x'] }, props: {}, hooked: true })
    await tick()
    expect(client.snapshot('Pane', 'p').status).toBe('off')
  })
})
