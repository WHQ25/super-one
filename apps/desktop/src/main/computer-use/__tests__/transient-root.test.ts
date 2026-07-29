import { beforeEach, describe, expect, it } from 'vitest'
import { ComputerUseService, resetComputerUseIds } from '../computer-use-service'
import type { PlatformActRequest, PlatformAdapter, PlatformLook } from '../platform/types'
import type { UiRootIdentity } from '../types'

const PARENT: Omit<UiRootIdentity, 'rootId'> = {
  kind: 'window',
  app: 'Fixture',
  bundleId: 'dev.superone.fixture',
  pid: 42,
  title: 'Fixture',
  bounds: { x: 20, y: 20, width: 800, height: 600 },
  focused: false,
  visible: true,
  minimized: false,
  modal: false,
  resourceKey: 'pid:42',
  windowId: 101,
}

const SHEET: Omit<UiRootIdentity, 'rootId'> = {
  ...PARENT,
  kind: 'sheet',
  title: 'Save',
  bounds: { x: 180, y: 80, width: 480, height: 280 },
  focused: true,
  modal: true,
  windowId: undefined,
  axRootId: 'axr:1',
}

const CG_SHEET: Omit<UiRootIdentity, 'rootId'> = {
  ...SHEET,
  windowId: 202,
}

class ClosingTransientAdapter implements PlatformAdapter {
  sheetOpen = true
  failWhileOpen = false

  async listRoots(): Promise<Array<Omit<UiRootIdentity, 'rootId'>>> {
    return this.sheetOpen ? [PARENT, SHEET] : [PARENT]
  }

  async look(root: UiRootIdentity): Promise<PlatformLook> {
    if (root.axRootId && this.failWhileOpen) throw new Error('capture failed')
    if (root.axRootId && !this.sheetOpen) throw new Error('AX root closed')
    return {
      root,
      outline: root.axRootId
        ? {
            ref: '@e1',
            role: 'sheet',
            children: [{ ref: '@e2', role: 'button', name: 'Save', capabilities: { press: true } }],
          }
        : { ref: '@e1', role: 'window', name: 'Fixture' },
      coordinateSpace: {
        width: root.bounds.width,
        height: root.bounds.height,
        scale: 1,
        fullScreen: false,
        kind: 'window',
        ...(root.windowId === undefined ? {} : { windowId: root.windowId }),
        ...(root.axRootId ? { axRootId: root.axRootId } : {}),
        capturedBounds: { ...root.bounds },
      },
      nativeLookId: root.axRootId ? 'sheet' : 'parent',
    }
  }

  async act(_request: PlatformActRequest) {
    this.sheetOpen = false
    return {
      steps: [{ applied: true, unknown: true, description: 'close sheet' }],
    }
  }
}

class DelayedClosingTransientAdapter extends ClosingTransientAdapter {
  override async act(_request: PlatformActRequest) {
    setTimeout(() => {
      this.sheetOpen = false
    }, 20)
    return {
      steps: [{ applied: true, unknown: true, description: 'close sheet asynchronously' }],
    }
  }
}

class GhostingCgTransientAdapter extends ClosingTransientAdapter {
  private ghostScans = 0

  override async listRoots(): Promise<Array<Omit<UiRootIdentity, 'rootId'>>> {
    if (this.sheetOpen) return [PARENT, CG_SHEET]
    if (this.ghostScans > 0) {
      this.ghostScans -= 1
      return [
        PARENT,
        { ...CG_SHEET, kind: 'window', modal: false, axRootId: undefined },
      ]
    }
    return [PARENT]
  }

  override async act(_request: PlatformActRequest) {
    this.sheetOpen = false
    this.ghostScans = 1
    return {
      steps: [{ applied: true, unknown: true, description: 'close CG-backed sheet' }],
    }
  }
}

describe('transient root lifecycle', () => {
  beforeEach(() => resetComputerUseIds())

  it('re-observes the parent when an action closes an AX-only root', async () => {
    const adapter = new ClosingTransientAdapter()
    const service = new ComputerUseService({ adapter })
    service.policy.setEnabled(true)
    service.policy.grant({ app: 'Fixture', bundleId: 'dev.superone.fixture', tier: 'full' })
    const sheet = (await service.listUiRoots()).find((root) => root.kind === 'sheet')!
    const observed = await service.observe(sheet.rootId, 'semantic')

    const result = await service.act(observed.stateId, [{ type: 'press', ref: '@e2' }], {
      delivery: 'semantic',
    })

    expect(result.successorRoot).toMatchObject({ kind: 'window', windowId: 101 })
    expect(service.getStateStore().get(result.successorStateId)?.root.rootId).toBe('@r1')
    expect(service.getScheduler().epoch('pid:42')).toBe(1)
  })

  it('does not treat an observe failure as a closed transient root', async () => {
    const adapter = new ClosingTransientAdapter()
    const service = new ComputerUseService({ adapter })
    service.policy.setEnabled(true)
    service.policy.grant({ app: 'Fixture', bundleId: 'dev.superone.fixture', tier: 'full' })
    const sheet = (await service.listUiRoots()).find((root) => root.kind === 'sheet')!
    const observed = await service.observe(sheet.rootId, 'semantic')
    adapter.failWhileOpen = true
    adapter.act = async () => ({
      steps: [{ applied: true, unknown: true, description: 'keep sheet open' }],
    })

    await expect(service.act(observed.stateId, [{ type: 'press', ref: '@e2' }], {
      delivery: 'semantic',
    })).rejects.toThrow('capture failed')
  })

  it('waits for an asynchronously closing transient before choosing the successor', async () => {
    const adapter = new DelayedClosingTransientAdapter()
    const service = new ComputerUseService({ adapter })
    service.policy.setEnabled(true)
    service.policy.grant({ app: 'Fixture', bundleId: 'dev.superone.fixture', tier: 'full' })
    const sheet = (await service.listUiRoots()).find((root) => root.kind === 'sheet')!
    const observed = await service.observe(sheet.rootId, 'semantic')

    const result = await service.act(observed.stateId, [{ type: 'press', ref: '@e2' }], {
      delivery: 'semantic',
    })

    expect(result.successorRoot).toMatchObject({ kind: 'window', windowId: 101 })
    expect(service.getStateStore().get(result.successorStateId)?.root.rootId).toBe('@r1')
  })

  it('ignores a closing transient CGWindow that briefly outlives its AX root', async () => {
    const adapter = new GhostingCgTransientAdapter()
    const service = new ComputerUseService({ adapter })
    service.policy.setEnabled(true)
    service.policy.grant({ app: 'Fixture', bundleId: 'dev.superone.fixture', tier: 'full' })
    const sheet = (await service.listUiRoots()).find((root) => root.kind === 'sheet')!
    const observed = await service.observe(sheet.rootId, 'semantic')

    const result = await service.act(observed.stateId, [{ type: 'press', ref: '@e2' }], {
      delivery: 'semantic',
    })

    expect(result.successorRoot).toMatchObject({ kind: 'window', windowId: 101 })
    expect(result.successorRoot.rootId).toBe('@r1')
  })
})
