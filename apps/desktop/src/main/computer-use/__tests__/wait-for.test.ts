import { describe, expect, it } from 'vitest'
import { ComputerUseService } from '../computer-use-service'
import type {
  CaptureScope,
  ObserveMode,
  UiOutlineNode,
  UiRootIdentity,
} from '../types'
import type { PlatformAdapter, PlatformLook } from '../platform/types'

const ROOT: Omit<UiRootIdentity, 'rootId'> = {
  kind: 'window',
  app: 'Wait Fixture',
  bundleId: 'dev.superone.wait-fixture',
  pid: 4242,
  title: 'Wait Fixture',
  bounds: { x: 100, y: 100, width: 480, height: 320 },
  focused: true,
  visible: true,
  minimized: false,
  modal: false,
  resourceKey: 'pid:4242',
  windowId: 777,
  windowLayer: 0,
}

class SequencedAdapter implements PlatformAdapter {
  private lookIndex = 0

  constructor(private readonly outlines: UiOutlineNode[]) {}

  async listRoots(): Promise<Array<Omit<UiRootIdentity, 'rootId'>>> {
    return [ROOT]
  }

  async look(
    _root: UiRootIdentity,
    mode: ObserveMode,
    capture: CaptureScope,
  ): Promise<PlatformLook> {
    const outline = this.outlines[Math.min(this.lookIndex, this.outlines.length - 1)]!
    this.lookIndex += 1
    return {
      root: ROOT,
      outline,
      coordinateSpace: {
        width: ROOT.bounds.width,
        height: ROOT.bounds.height,
        scale: 2,
        fullScreen: false,
        kind: capture,
        windowId: ROOT.windowId,
        capturedBounds: ROOT.bounds,
      },
      image: mode === 'semantic'
        ? undefined
        : { mimeType: 'image/png', data: 'fixture', width: 480, height: 320 },
      nativeLookId: `wait-look-${this.lookIndex}`,
    }
  }

  async act(): Promise<{ steps: Array<{ applied: boolean; unknown: boolean; description: string }> }> {
    return {
      steps: [{ applied: true, unknown: true, description: 'fixture delivery' }],
    }
  }
}

function outline(children: UiOutlineNode[]): UiOutlineNode {
  return {
    ref: '@e1',
    role: 'window',
    name: 'Wait Fixture',
    bounds: { x: 0, y: 0, width: 480, height: 320 },
    children,
  }
}

function statusNode(ref: string, value: string, y = 40): UiOutlineNode {
  return {
    ref,
    role: 'staticText',
    name: 'Status',
    value,
    bounds: { x: 20, y, width: 160, height: 24 },
  }
}

function serviceFor(outlines: UiOutlineNode[]): ComputerUseService {
  const service = new ComputerUseService({ adapter: new SequencedAdapter(outlines) })
  service.policy.setEnabled(true)
  service.policy.grant({ app: ROOT.app, bundleId: ROOT.bundleId, tier: 'full' })
  return service
}

describe('computer_wait_for with real polling', () => {
  it('reports preexisting from the immutable base observation', async () => {
    const service = serviceFor([
      outline([statusNode('@e2', 'Ready')]),
      outline([statusNode('@e2', 'Changed later')]),
    ])
    const base = await service.observe(undefined, 'semantic')
    const result = await service.waitFor(
      base.stateId,
      { kind: 'valueEquals', ref: '@e2', value: 'Ready' },
      100,
    )
    expect(result.status).toBe('preexisting')
  })

  it('recovers a shifted AX ref before reporting verified', async () => {
    const service = serviceFor([
      outline([statusNode('@e2', 'Loading')]),
      outline([
        {
          ref: '@e2',
          role: 'staticText',
          name: 'Inserted',
          value: 'Ready',
          bounds: { x: 20, y: 8, width: 160, height: 24 },
        },
        statusNode('@e3', 'Ready'),
      ]),
    ])
    const base = await service.observe(undefined, 'semantic')
    const result = await service.waitFor(
      base.stateId,
      { kind: 'valueEquals', ref: '@e2', value: 'Ready' },
      150,
    )
    expect(result.status).toBe('verified')
    expect(service.getStateStore().get(result.successorStateId)?.outline.children?.[1]?.ref)
      .toBe('@e3')
  })

  it('reports failed instead of accepting an ambiguous replacement', async () => {
    const baseTarget: UiOutlineNode = {
      ref: '@e2',
      role: 'textField',
      value: 'Loading',
    }
    const service = serviceFor([
      outline([baseTarget]),
      outline([
        { ref: '@e3', role: 'textField', value: 'Ready' },
        { ref: '@e4', role: 'textField', value: 'Ready' },
      ]),
    ])
    const base = await service.observe(undefined, 'semantic')
    const result = await service.waitFor(
      base.stateId,
      { kind: 'valueEquals', ref: '@e2', value: 'Ready' },
      100,
    )
    expect(result.status).toBe('failed')
  })

  it('does not treat a reused ref as the original target still existing', async () => {
    const service = serviceFor([
      outline([statusNode('@e2', 'Visible')]),
      outline([{
        ref: '@e2',
        role: 'staticText',
        name: 'Replacement',
        value: 'Visible',
        bounds: { x: 20, y: 40, width: 160, height: 24 },
      }]),
    ])
    const base = await service.observe(undefined, 'semantic')
    const result = await service.waitFor(
      base.stateId,
      { kind: 'notExists', ref: '@e2' },
      150,
    )
    expect(result.status).toBe('verified')
  })

  it('rebinds act postconditions when the successor ref shifts', async () => {
    const service = serviceFor([
      outline([statusNode('@e2', 'Loading')]),
      outline([
        {
          ref: '@e2',
          role: 'staticText',
          name: 'Inserted',
          value: 'Ready',
          bounds: { x: 20, y: 8, width: 160, height: 24 },
        },
        statusNode('@e3', 'Ready'),
      ]),
    ])
    const base = await service.observe(undefined, 'semantic')
    const result = await service.act(
      base.stateId,
      [{ type: 'keypress', keys: ['Enter'] }],
      { expect: { kind: 'valueEquals', ref: '@e2', value: 'Ready' } },
    )
    expect(result.outcome).toBe('worked')
  })
})
