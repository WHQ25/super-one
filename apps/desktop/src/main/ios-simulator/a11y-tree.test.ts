import { describe, expect, it } from 'vitest'
import { collectNodes } from '../device/tree'
import {
  guestToFramebufferBounds,
  guestToFramebufferPoint,
  normalizeAccessibilityTree,
  type IosSimulatorAccessibilityDump,
} from './a11y-tree'

/** An iPhone 17 Pro Max: 440x956 points upright, 956x440 on its side. */
const PORTRAIT_SCREEN = { width: 440, height: 956 }
const LANDSCAPE_SCREEN = { width: 956, height: 440 }

function dump(tree: IosSimulatorAccessibilityDump['tree']): IosSimulatorAccessibilityDump {
  return { generation: 1, nodes: 1, complete: true, tree }
}

describe('guestToFramebufferPoint', () => {
  it('is the identity upright', () => {
    expect(guestToFramebufferPoint(0.25, 0.75, 'portrait')).toEqual([0.25, 0.75])
  })

  it('maps the four orientations as measured against a real device', () => {
    const u = 0.2
    const v = 0.6
    expect(guestToFramebufferPoint(u, v, 'portrait')).toEqual([0.2, 0.6])
    expect(guestToFramebufferPoint(u, v, 'landscape-right')).toEqual([0.6, 0.8])
    expect(guestToFramebufferPoint(u, v, 'portrait-upside-down')).toEqual([0.8, 0.4])
    expect(guestToFramebufferPoint(u, v, 'landscape-left')).toEqual([0.4, 0.2])
  })

  it('sends the landscape pair to opposite corners', () => {
    // The trap this guards: Apple's landscapeLeft/Right name where the home button
    // ends up, not which way the device turned, so reading the names as directions
    // lands both of them 180 degrees out.
    const right = guestToFramebufferPoint(0.1, 0.1, 'landscape-right')
    const left = guestToFramebufferPoint(0.1, 0.1, 'landscape-left')
    expect(right[0]).toBeCloseTo(1 - left[0], 10)
    expect(right[1]).toBeCloseTo(1 - left[1], 10)
  })

  it('keeps the centre fixed under every rotation', () => {
    for (const orientation of ['portrait', 'landscape-left', 'landscape-right', 'portrait-upside-down'] as const) {
      expect(guestToFramebufferPoint(0.5, 0.5, orientation)).toEqual([0.5, 0.5])
    }
  })
})

describe('guestToFramebufferBounds', () => {
  it('normalizes an upright rect against the screen', () => {
    // The Settings icon on the home screen, as the device actually reported it.
    expect(guestToFramebufferBounds([335, 418, 72, 95], PORTRAIT_SCREEN, 'portrait'))
      .toEqual([0.7614, 0.4372, 0.1636, 0.0994])
  })

  it('puts a landscape address bar where the screenshot shows it', () => {
    // Safari in landscape-right draws its address bar across the top of the rotated
    // UI, which lands on the LEFT edge of the unrotated framebuffer, vertically
    // centred. Measured from a real capture; see a11y-tree.ts.
    const [x, y, width, height] = guestToFramebufferBounds(
      [456, 31, 40, 40], LANDSCAPE_SCREEN, 'landscape-right')!
    expect(x + width / 2).toBeCloseTo(0.12, 2)
    expect(y + height / 2).toBeCloseTo(0.5, 2)
  })

  it('reports positive extents after a quarter turn', () => {
    const bounds = guestToFramebufferBounds([100, 50, 200, 80], LANDSCAPE_SCREEN, 'landscape-left')!
    expect(bounds[2]).toBeGreaterThan(0)
    expect(bounds[3]).toBeGreaterThan(0)
    // A quarter turn swaps which axis carries which extent.
    expect(bounds[2]).toBeCloseTo(80 / LANDSCAPE_SCREEN.height, 4)
    expect(bounds[3]).toBeCloseTo(200 / LANDSCAPE_SCREEN.width, 4)
  })

  it('declines to guess when the screen size is unknown', () => {
    expect(guestToFramebufferBounds([0, 0, 10, 10], { width: 0, height: 0 }, 'portrait'))
      .toBeUndefined()
  })
})

describe('normalizeAccessibilityTree', () => {
  const sample = dump({
    uid: 0,
    role: 'AXApplication',
    frame: [0, 0, 440, 956],
    children: [
      {
        uid: 10,
        role: 'AXButton',
        label: 'Settings',
        identifier: 'Settings',
        frame: [335, 418, 72, 95],
      },
      { uid: 11, role: 'AXSlider', label: 'Search', value: 'Page 1 of 2', enabled: false },
    ],
  })

  it('assigns refs in traversal order and maps them back to helper uids', () => {
    const { root, refs } = normalizeAccessibilityTree(sample, 'portrait')
    expect(collectNodes(root).map((node) => node.ref)).toEqual(['@e0', '@e1', '@e2'])
    // Refs are positional; uids are the helper's own naming. The mapping is what
    // lets an action reach the element without leaking uids to the agent.
    expect(refs.get('@e1')).toBe(10)
    expect(refs.get('@e2')).toBe(11)
  })

  it('carries the identifier through, since it outlives copy changes', () => {
    const { root } = normalizeAccessibilityTree(sample, 'portrait')
    expect(root.children?.[0]?.identifier).toBe('Settings')
  })

  it('reads the screen size off the root frame', () => {
    expect(normalizeAccessibilityTree(sample, 'portrait').screenPoints).toEqual(PORTRAIT_SCREEN)
  })

  it('only reports enabled and focused when they are not the default', () => {
    const { root } = normalizeAccessibilityTree(sample, 'portrait')
    expect(root.children?.[0]).not.toHaveProperty('enabled')
    expect(root.children?.[1]?.enabled).toBe(false)
  })

  it('rotates child bounds with the tree', () => {
    const upright = normalizeAccessibilityTree(sample, 'portrait').root.children?.[0]?.bounds
    const turned = normalizeAccessibilityTree(sample, 'landscape-right').root.children?.[0]?.bounds
    expect(turned).not.toEqual(upright)
  })

  it('survives a node with no frame at all', () => {
    const { root } = normalizeAccessibilityTree(sample, 'portrait')
    expect(root.children?.[1]).not.toHaveProperty('bounds')
  })
})

