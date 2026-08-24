import { describe, it, expect, beforeEach, vi } from 'vitest'
import { existsSync } from 'fs'
import { ComputerUseService, resetComputerUseIds } from '../computer-use-service'
import { findNode, searchOutline } from '../outline'
import { boundText, clearContinuations, getContinuationRaw, readContinuation } from '../result-view'
import { ComputerUseError } from '../types'
import { COMPUTER_USE_SCREENSHOT_DIR } from '../screenshot-store'
import {
  COMPUTER_USE_TOOL_NAMES,
  clearComputerUseServices,
  executeComputerUseTool,
  getComputerUseToolDescriptors,
  getOrCreateComputerUseService,
  isComputerUseEnabled,
  registerComputerUseTools,
  hideComputerUseVisuals,
  setComputerUseEnabledForTests,
} from '../tools'

function enableAll(service: ComputerUseService): void {
  service.policy.setEnabled(true)
  service.policy.grant({ app: 'Notes', bundleId: 'com.apple.Notes', tier: 'full' })
  service.policy.grant({
    app: 'System Settings',
    bundleId: 'com.apple.systempreferences',
    tier: 'full',
  })
}

describe('Computer Use P0 contract', () => {
  let service: ComputerUseService

  beforeEach(() => {
    clearComputerUseServices()
    resetComputerUseIds()
    clearContinuations()
    setComputerUseEnabledForTests(null)
    service = new ComputerUseService()
    enableAll(service)
  })

  // ── tool surface ─────────────────────────────────────────

  it('exposes exactly six stable tool names', () => {
    expect(COMPUTER_USE_TOOL_NAMES).toHaveLength(6)
    const names = getComputerUseToolDescriptors().map((d) => d.name)
    expect(names).toEqual([...COMPUTER_USE_TOOL_NAMES])
    for (const d of getComputerUseToolDescriptors()) {
      expect(d.inputSchema).toBeTypeOf('object')
      expect(d.description.length).toBeGreaterThan(20)
      expect((d.inputSchema as any).required).toContain('description')
      expect((d.inputSchema as any).properties.description.description).toContain(
        'human-friendly',
      )
    }
    const observe = getComputerUseToolDescriptors().find((d) => d.name === 'computer_snapshot')!
    expect((observe.inputSchema as any).properties.capture.enum).toEqual(['window', 'display'])
    const act = getComputerUseToolDescriptors().find((d) => d.name === 'computer_act')!
    expect((act.inputSchema as any).properties.recording.type).toBe('boolean')
  })

  it('is disabled by default and not listed until enabled', async () => {
    expect(isComputerUseEnabled()).toBe(false)
    const s = getOrCreateComputerUseService('sess-gate')
    // Service starts with policy disabled
    await expect(s.apps()).rejects.toMatchObject({ code: 'BACKEND' })
  })


  // ── observe / state ownership ────────────────────────────

  it('observe creates immutable stateId with epoch and coordinate space', async () => {
    const obs = await service.observe()
    expect(obs.stateId).toMatch(/^S\d+$/)
    expect(obs.capture).toBe('window')
    expect(obs.coordinateSpace.fullScreen).toBe(false)
    expect(obs.coordinateSpace.kind).toBe('window')
    expect(obs.coordinateSpace.width).toBe(800)
    expect(obs.outline.ref).toMatch(/^@e\d+$/)
    expect(obs.truncation.maxDepth).toBeGreaterThan(0)

    const stored = service.getStateStore().get(obs.stateId)!
    expect(stored.epoch).toBe(0)
    expect(stored.outline.children?.length).toBeGreaterThan(0)
    // Folded view may omit deep nodes while store keeps full outline
    expect(stored.outline).not.toBe(obs.outline)
  })

  it('query reads cached state without requiring a new capture identity', async () => {
    const obs = await service.observe()
    const search = await service.query(obs.stateId, 'search', { text: 'Save' })
    expect(search.matches?.some((m) => m.name === 'Save')).toBe(true)

    const saveRef = search.matches!.find((m) => m.name === 'Save')!.ref
    const inspected = await service.query(obs.stateId, 'inspect', { ref: saveRef })
    expect(inspected.element?.name).toBe('Save')
    expect(inspected.element?.children).toBeUndefined()

    const expanded = await service.query(obs.stateId, 'expand', { ref: obs.outline.ref, depth: 4 })
    expect(expanded.subtree?.children?.length).toBeGreaterThan(0)
  })

  it('query rejects unknown ref and unknown state', async () => {
    const obs = await service.observe()
    await expect(service.query(obs.stateId, 'inspect', { ref: '@e9999' })).rejects.toMatchObject({
      code: 'UNKNOWN_REF',
    })
    await expect(service.query('S999', 'search', { text: 'x' })).rejects.toMatchObject({
      code: 'UNKNOWN_STATE',
    })
  })

  // ── zoom coordinate invariant ────────────────────────────

  it('zoom does not create a new coordinate space', async () => {
    const obs = await service.observe(undefined, 'visual')
    const z = await service.zoom(obs.stateId, [100, 100, 300, 250])
    expect(z.stateId).toBe(obs.stateId)
    expect(z.coordinateSpace).toEqual(obs.coordinateSpace)
    expect(z.image.data).toContain('fake-zoom')
  })

  it('supports explicit display capture', async () => {
    const obs = await service.observe(undefined, 'visual', 'display')
    expect(obs.capture).toBe('display')
    expect(obs.coordinateSpace).toMatchObject({ kind: 'display', fullScreen: true })
    expect(obs.coordinateSpace.width).toBe(1440)
  })

  // ── act + outcomes ───────────────────────────────────────

  it('act setText returns worked with successor state and value diff', async () => {
    const obs = await service.observe()
    const title = searchOutline(service.getStateStore().get(obs.stateId)!.outline, 'Title')[0]
    expect(title).toBeTruthy()

    const result = await service.act(obs.stateId, [
      { type: 'setText', ref: title.ref, text: 'Hello' },
    ])
    expect(result.outcome).toBe('worked')
    expect(result.successorStateId).not.toBe(obs.stateId)
    expect(result.diff?.changed.some((c) => c.field === 'value' && c.to === 'Hello')).toBe(true)

    const after = service.getStateStore().get(result.successorStateId)!
    expect(findNode(after.outline, title.ref)?.value).toBe('Hello')
  })

  it('act on ignoreEvents target returns didnt', async () => {
    const obs = await service.observe()
    const broken = searchOutline(service.getStateStore().get(obs.stateId)!.outline, 'Broken')[0]
    const result = await service.act(obs.stateId, [{ type: 'press', ref: broken.ref }])
    expect(result.outcome).toBe('didnt')
    expect(result.evidence[0]?.description).toMatch(/ignored/)
  })

  it('act returns unknown when platform silent-delivery flag is set', async () => {
    const obs = await service.observe()
    service.getFake().silentDelivery = true
    const save = searchOutline(service.getStateStore().get(obs.stateId)!.outline, 'Save')[0]
    const result = await service.act(obs.stateId, [{ type: 'press', ref: save.ref }])
    expect(result.outcome).toBe('unknown')
  })

  it('act supports multi-step focus inheritance (setText then typeText)', async () => {
    const obs = await service.observe()
    const body = searchOutline(service.getStateStore().get(obs.stateId)!.outline, 'Body')[0]
    const result = await service.act(obs.stateId, [
      { type: 'setText', ref: body.ref, text: 'Hi' },
      { type: 'typeText', text: ' there' },
    ])
    expect(result.outcome).toBe('worked')
    const after = service.getStateStore().get(result.successorStateId)!
    expect(findNode(after.outline, body.ref)?.value).toBe('Hi there')
  })

  it('act rejects more than 20 actions', async () => {
    const obs = await service.observe()
    const actions = Array.from({ length: 21 }, () => ({ type: 'keypress' as const, keys: ['a'] }))
    await expect(service.act(obs.stateId, actions)).rejects.toMatchObject({ code: 'INVALID_ACTION' })
  })

  // ── stale write rejection ────────────────────────────────

  it('rejects stale act before side effects (epoch)', async () => {
    const first = await service.observe()
    const second = await service.observe()
    // Both capture epoch 0; first act advances epoch.
    const title = searchOutline(service.getStateStore().get(first.stateId)!.outline, 'Title')[0]

    const ok = await service.act(first.stateId, [
      { type: 'setText', ref: title.ref, text: 'from-first' },
    ])
    expect(ok.outcome).toBe('worked')

    let sideEffect = false
    try {
      await service.act(second.stateId, [
        { type: 'setText', ref: title.ref, text: 'from-stale' },
      ])
      sideEffect = true
    } catch (e) {
      expect(e).toBeInstanceOf(ComputerUseError)
      expect((e as ComputerUseError).code).toBe('STALE_STATE')
    }
    expect(sideEffect).toBe(false)

    // Value remains from the successful write, not the stale one.
    const latest = await service.observe()
    expect(findNode(service.getStateStore().get(latest.stateId)!.outline, title.ref)?.value).toBe(
      'from-first',
    )
  })

  it('advances epoch even when outcome is unknown (no concurrent stale success)', async () => {
    const a = await service.observe()
    const b = await service.observe()
    service.getFake().silentDelivery = true
    const save = searchOutline(service.getStateStore().get(a.stateId)!.outline, 'Save')[0]
    const r = await service.act(a.stateId, [{ type: 'press', ref: save.ref }])
    expect(r.outcome).toBe('unknown')

    await expect(
      service.act(b.stateId, [{ type: 'press', ref: save.ref }]),
    ).rejects.toMatchObject({ code: 'STALE_STATE' })
  })

  it('rejects act before side effects when the target window disappeared', async () => {
    const obs = await service.observe()
    const save = searchOutline(service.getStateStore().get(obs.stateId)!.outline, 'Save')[0]
    service.getFake().removeWindow(1001, 'Notes')

    await expect(
      service.act(obs.stateId, [{ type: 'press', ref: save.ref }]),
    ).rejects.toMatchObject({ code: 'STALE_STATE' })
    expect(service.getScheduler().epoch('pid:1001')).toBe(0)
  })

  // ── wait_for ─────────────────────────────────────────────

  it('wait_for reports preexisting when condition already holds', async () => {
    const obs = await service.observe()
    const save = searchOutline(service.getStateStore().get(obs.stateId)!.outline, 'Save')[0]
    const w = await service.waitFor(obs.stateId, { kind: 'exists', ref: save.ref }, 200)
    expect(w.status).toBe('preexisting')
    expect(w.successorStateId).toBeTruthy()
  })

  it('wait_for reports verified when condition becomes true after base snapshot', async () => {
    const base = await service.observe()
    const title = searchOutline(service.getStateStore().get(base.stateId)!.outline, 'Title')[0]
    expect(findNode(service.getStateStore().get(base.stateId)!.outline, title.ref)?.value).toBe('')

    // Mutate the live world after base is frozen. wait_for must not treat the
    // base snapshot as success (preexisting), only a later re-observe.
    await service.act(base.stateId, [{ type: 'setText', ref: title.ref, text: 'Ready' }])

    const w = await service.waitFor(
      base.stateId,
      { kind: 'valueEquals', ref: title.ref, value: 'Ready' },
      500,
    )
    expect(w.status).toBe('verified')
  })

  it('wait_for reports failed on timeout', async () => {
    const obs = await service.observe()
    const w = await service.waitFor(
      obs.stateId,
      { kind: 'exists', ref: '@e-never' },
      100,
    )
    expect(w.status).toBe('failed')
  })

  // ── apps / policy ────────────────────────────────────────

  it('apps lists granted, running, and frontmost', async () => {
    const snap = await service.apps()
    expect(snap.action).toBe('list')
    if (snap.action !== 'list') return
    expect(snap.apps.some((a) => a.bundleId === 'com.apple.Notes' && a.granted)).toBe(true)
    expect(snap.apps.some((a) => a.app === 'Notes' && a.running)).toBe(true)
    expect(snap.frontmost).toBeTruthy()
  })

  it('blocks act when app not granted', async () => {
    const locked = new ComputerUseService()
    locked.policy.setEnabled(true)
    // no grants
    await expect(locked.observe()).rejects.toMatchObject({ code: 'NOT_GRANTED' })
  })

  it('enforces click tier against typeText', async () => {
    service.policy.grant({ app: 'Notes', bundleId: 'com.apple.Notes', tier: 'click' })
    const obs = await service.observe()
    const title = searchOutline(service.getStateStore().get(obs.stateId)!.outline, 'Title')[0]
    await expect(
      service.act(obs.stateId, [{ type: 'typeText', ref: title.ref, text: 'x' }]),
    ).rejects.toMatchObject({ code: 'TIER_BLOCKED' })
  })

  // ── output bounds ────────────────────────────────────────

  it('bounds oversized output with immutable continuation ref', () => {
    const big = 'x'.repeat(50_000)
    const bound = boundText(big, { maxChars: 1000, previewChars: 100 })
    expect(bound.truncated).toBe(true)
    expect(bound.text).toHaveLength(100)
    expect(bound.continuationRef).toMatch(/^@o\d+$/)
    const raw = getContinuationRaw(bound.continuationRef!)
    expect(raw).toBe(big)
    const page = readContinuation(bound.continuationRef!, 0, 50)!
    expect(page.text).toHaveLength(50)
    expect(page.done).toBe(false)
    // Immutable: same ref always returns same payload
    expect(getContinuationRaw(bound.continuationRef!)).toBe(big)
  })

  it('service.boundJson truncates large payloads', async () => {
    const obs = await service.observe()
    const huge = { pad: 'y'.repeat(60_000), stateId: obs.stateId }
    const bound = service.boundJson(huge)
    expect(bound.truncated).toBe(true)
    expect(bound.continuationRef).toBeTruthy()
  })

  // ── successor diff / full view fallback ──────────────────

  it('reports fullViewFallback when topology is replaced', async () => {
    const obs = await service.observe()
    service.getFake().replaceWindowTree(1001, 'Notes', {
      role: 'window',
      name: 'Notes',
      children: [{ role: 'staticText', name: 'Completely New Tree' }],
    })
    // Act still requires valid epoch — use a no-op path: observe after replace for diff via act keypress
    const base = await service.observe()
    // Force act to re-look and diff against base... keypress doesn't change tree
    // Instead compare outlines ourselves via a synthetic act that re-observes:
    const r = await service.act(base.stateId, [{ type: 'keypress', keys: ['Escape'] }])
    // Same tree after keypress — fullViewFallback false
    expect(r.diff?.fullViewFallback).toBe(false)

    // Now replace between observe and act using stale path differently:
    // Observe S, replace tree (new refs), act keypress → successor has almost no overlap with S outline
    const s = await service.observe()
    service.getFake().replaceWindowTree(1001, 'Notes', {
      role: 'window',
      name: 'Notes',
      children: [
        { role: 'button', name: 'OnlyButton' },
        { role: 'staticText', name: 'OnlyText' },
      ],
    })
    const r2 = await service.act(s.stateId, [{ type: 'keypress', keys: ['a'] }])
    expect(r2.diff?.fullViewFallback).toBe(true)
    expect(r2.diff!.added.length + r2.diff!.removed.length).toBeGreaterThan(0)
  })

  // ── modal root discovery ─────────────────────────────────

  it('opening Share creates a dialog root discoverable via apps/listRoots', async () => {
    const obs = await service.observe()
    const share = searchOutline(service.getStateStore().get(obs.stateId)!.outline, 'Share')[0]
    await service.act(obs.stateId, [{ type: 'press', ref: share.ref }])
    const snap = await service.apps()
    const roots = await service.getFake().listRoots()
    expect(roots.some((r) => r.kind === 'dialog' && r.title === 'Share Note')).toBe(true)
    expect(snap.action).toBe('list')
    if (snap.action === 'list') {
      expect(snap.apps.some((a) => a.app === 'Notes' && a.running)).toBe(true)
    }
  })

  it('blocks parent-window actions while a modal root is open', async () => {
    const obs = await service.observe()
    const share = searchOutline(service.getStateStore().get(obs.stateId)!.outline, 'Share')[0]
    const opened = await service.act(obs.stateId, [{ type: 'press', ref: share.ref }])
    const parentState = service.getStateStore().get(opened.successorStateId)!
    const save = searchOutline(parentState.outline, 'Save')[0]

    await expect(
      service.act(opened.successorStateId, [{ type: 'press', ref: save.ref }]),
    ).rejects.toMatchObject({
      code: 'MODAL_BLOCKED',
      details: {
        rootId: parentState.root.rootId,
        modalRoots: [expect.objectContaining({ kind: 'dialog', title: 'Share Note' })],
      },
    })

    const modal = (await service.listUiRoots()).find((root) => root.title === 'Share Note')
    expect(modal).toMatchObject({ kind: 'dialog', modal: true })
    const modalObs = await service.observe(modal!.rootId)
    const confirm = searchOutline(
      service.getStateStore().get(modalObs.stateId)!.outline,
      'Share',
    )[0]
    const result = await service.act(modalObs.stateId, [{ type: 'press', ref: confirm.ref }])
    expect(result.outcome).not.toBe('didnt')
  })

  // ── tool execute path ────────────────────────────────────

  it('executeComputerUseTool wires through service when enabled', async () => {
    setComputerUseEnabledForTests(true)
    // Force fake backend — auto may pick macos helper when dist/ exists.
    const s = getOrCreateComputerUseService('sess-1', { backend: 'fake' } as never)
    s.policy.setEnabled(true)
    s.policy.grant({ app: 'Notes', bundleId: 'com.apple.Notes', tier: 'full' })

    const appsReply = await executeComputerUseTool('sess-1', 'computer_apps', {
      description: 'Check available desktop apps',
    })
    expect(appsReply.isError).toBeFalsy()
    const text = appsReply.content[0]!.text!
    // TOON catalog: apps[N]{...}: table + scalar fields
    expect(text).toMatch(/apps\[\d+\]/)
    expect(text).toMatch(/action:\s*list/)
    expect(text).toMatch(/bundleId/)

    const obsReply = await executeComputerUseTool('sess-1', 'computer_snapshot', {
      description: 'Inspect the Notes window',
      mode: 'semantic',
    })
    const obs = JSON.parse(obsReply.content[0]!.text!)
    expect(obs.stateId).toBeTruthy()
    expect(obs.capture).toBe('window')
    expect(obs.image).toBeUndefined() // semantic mode

    const qReply = await executeComputerUseTool('sess-1', 'computer_query', {
      description: 'Find the Save button',
      stateId: obs.stateId,
      op: 'search',
      text: 'Save',
    })
    const q = JSON.parse(qReply.content[0]!.text!)
    expect(q.matches.length).toBeGreaterThan(0)
  })

  it('does not let queued stale cleanup clear a newer tool call', async () => {
    setComputerUseEnabledForTests(true)
    const s = getOrCreateComputerUseService('sess-lifecycle', { backend: 'fake' } as never)
    s.policy.setEnabled(true)
    const originalApps = s.apps.bind(s)
    let releaseFirst!: () => void
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    let invocation = 0
    const appsSpy = vi.spyOn(s, 'apps').mockImplementation(async (...args) => {
      invocation += 1
      if (invocation === 1) await firstBlocked
      return originalApps(...args)
    })
    const clearSpy = vi.spyOn(s, 'clearVisuals')

    const first = executeComputerUseTool('sess-lifecycle', 'computer_apps', {
      description: 'Inspect desktop apps for the current turn',
    })
    await vi.waitFor(() => expect(appsSpy).toHaveBeenCalledTimes(1))
    const staleCleanup = hideComputerUseVisuals('sess-lifecycle')
    const next = executeComputerUseTool('sess-lifecycle', 'computer_apps', {
      description: 'Inspect desktop apps for the next turn',
    })

    releaseFirst()
    await Promise.all([first, staleCleanup, next])

    expect(appsSpy).toHaveBeenCalledTimes(2)
    expect(clearSpy).not.toHaveBeenCalled()
  })

  it('executeComputerUseTool observe visual returns image.path on disk (not base64)', async () => {
    setComputerUseEnabledForTests(true)
    const s = getOrCreateComputerUseService('sess-shot', { backend: 'fake' } as never)
    s.policy.setEnabled(true)
    s.policy.grant({ app: 'Notes', bundleId: 'com.apple.Notes', tier: 'full' })

    const obsReply = await executeComputerUseTool(
      'sess-shot',
      'computer_snapshot',
      { description: 'Capture the Notes window', mode: 'visual' },
    )
    const obs = JSON.parse(obsReply.content[0]!.text!)
    expect(obs.image?.path).toBeTruthy()
    expect(obs.image?.path.startsWith(COMPUTER_USE_SCREENSHOT_DIR)).toBe(true)
    expect(existsSync(obs.image.path)).toBe(true)
    expect(obs.image?.data).toBeUndefined()

    const zReply = await executeComputerUseTool(
      'sess-shot',
      'computer_zoom',
      {
        description: 'Inspect the document controls more closely',
        stateId: obs.stateId,
        region: [10, 10, 100, 100],
      },
    )
    const z = JSON.parse(zReply.content[0]!.text!)
    expect(z.image?.path.startsWith(COMPUTER_USE_SCREENSHOT_DIR)).toBe(true)
    expect(z.image?.data).toBeUndefined()
    expect(existsSync(z.image.path)).toBe(true)

    const actReply = await executeComputerUseTool(
      'sess-shot',
      'computer_act',
      {
        description: 'Activate the document control',
        stateId: obs.stateId,
        actions: [{ type: 'click', x: 10, y: 10 }],
      },
    )
    const act = JSON.parse(actReply.content[0]!.text!)
    expect(act.successorImage?.path.startsWith(COMPUTER_USE_SCREENSHOT_DIR)).toBe(true)
    expect(act.successorImage?.data).toBeUndefined()
    expect(existsSync(act.successorImage.path)).toBe(true)
  })

  it('rejects missing or blank human-readable descriptions', async () => {
    setComputerUseEnabledForTests(true)

    const missing = await executeComputerUseTool('sess-summary', 'computer_apps', {})
    expect(missing.isError).toBe(true)
    expect(missing.content[0]?.text).toContain('description is required')

    const blank = await executeComputerUseTool('sess-summary', 'computer_apps', {
      description: '   ',
    })
    expect(blank.isError).toBe(true)
    expect(blank.content[0]?.text).toContain('description is required')
  })

  it('registerComputerUseTools is a no-op when disabled and registers when enabled', () => {
    const registered: string[] = []
    const server = {
      registerTool: (name: string) => {
        registered.push(name)
        return { remove: () => {} }
      },
    }

    setComputerUseEnabledForTests(false)
    registerComputerUseTools(server as never, 'sess-reg')
    expect(registered).toEqual([])

    setComputerUseEnabledForTests(true)
    registerComputerUseTools(server as never, 'sess-reg')
    // Stable surface + one-release deprecated alias computer_observe → computer_snapshot.
    expect(registered).toEqual([...COMPUTER_USE_TOOL_NAMES, 'computer_observe'])
  })
})
