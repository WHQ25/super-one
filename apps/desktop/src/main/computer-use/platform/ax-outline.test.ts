import { describe, it, expect } from 'vitest'
import {
  axTreeToOutline,
  mapAxRole,
  parseElementIndex,
  pictureOnlyOutline,
} from './ax-outline'
import type { HelperAxNode } from './helper-protocol'

describe('ax-outline', () => {
  it('maps AX roles', () => {
    expect(mapAxRole('AXButton')).toBe('button')
    expect(mapAxRole('AXTextField')).toBe('textField')
    expect(mapAxRole('button')).toBe('button')
  })

  it('parses element refs', () => {
    expect(parseElementIndex('@e12')).toBe(12)
    expect(parseElementIndex('@r1')).toBeUndefined()
    expect(parseElementIndex('e1')).toBeUndefined()
  })

  it('converts helper tree to outline with @eN refs and capabilities', () => {
    const tree: HelperAxNode = {
      index: 1,
      role: 'AXWindow',
      name: 'Untitled',
      actions: ['AXRaise'],
      children: [
        {
          index: 2,
          role: 'AXTextArea',
          name: 'text',
          value: 'hello',
          settable: true,
          actions: [],
          bounds: { x: 10, y: 20, width: 100, height: 40 },
        },
        {
          index: 3,
          role: 'AXButton',
          name: 'Save',
          actions: ['AXPress'],
        },
      ],
    }
    const outline = axTreeToOutline(tree)
    expect(outline.ref).toBe('@e1')
    expect(outline.role).toBe('window')
    expect(outline.pictureOnly).toBe(false)
    expect(outline.children).toHaveLength(2)
    expect(outline.children![0]!.ref).toBe('@e2')
    expect(outline.children![0]!.capabilities?.setText).toBe(true)
    expect(outline.children![0]!.capabilities?.typeText).toBe(true)
    expect(outline.children![1]!.ref).toBe('@e3')
    expect(outline.children![1]!.capabilities?.press).toBe(true)
  })

  it('pictureOnlyOutline is coordinate grounding only', () => {
    const o = pictureOnlyOutline('Screen', 800, 600)
    expect(o.pictureOnly).toBe(true)
    expect(o.ref).toBe('@e1')
    expect(o.bounds).toEqual({ x: 0, y: 0, width: 800, height: 600 })
  })
})
