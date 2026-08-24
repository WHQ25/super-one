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

  it('keeps helper DFS indices when the helper elided wrapper nodes', () => {
    // The helper drops anonymous wrappers but keeps assigning them DFS indices,
    // because ax_action resolves a ref by re-walking the uncompressed tree.
    // Refs must therefore mirror node.index verbatim — never child position.
    const tree: HelperAxNode = {
      index: 1,
      role: 'AXWindow',
      actions: [],
      children: [
        { index: 9, role: 'AXWebArea', name: 'App', actions: [] },
        { index: 17, role: 'AXButton', name: 'Save', actions: ['AXPress'] },
      ],
    }
    const outline = axTreeToOutline(tree)
    expect(outline.children?.map((c) => c.ref)).toEqual(['@e9', '@e17'])
    expect(parseElementIndex(outline.children![1]!.ref)).toBe(17)
  })

  it('pictureOnlyOutline is coordinate grounding only', () => {
    const o = pictureOnlyOutline('Screen', 800, 600)
    expect(o.pictureOnly).toBe(true)
    expect(o.ref).toBe('@e1')
    expect(o.bounds).toEqual({ x: 0, y: 0, width: 800, height: 600 })
  })
})

describe('capabilities derived from AX roles', () => {
  const node = (role: string, extra: Partial<HelperAxNode> = {}): HelperAxNode =>
    ({ index: 1, role, actions: [], ...extra }) as HelperAxNode
  const caps = (role: string, extra: Partial<HelperAxNode> = {}) =>
    axTreeToOutline(node(role, extra)).capabilities!

  it('does not offer typing on roles that merely have "text" in the name', () => {
    // AXStaticText and AXWebArea both matched the old substring test, so every
    // label in a Chromium window advertised itself as a text input.
    expect(caps('AXStaticText').typeText).toBe(false)
    expect(caps('AXWebArea').typeText).toBe(false)
    expect(caps('AXHeading').typeText).toBe(false)
  })

  it('still offers typing on the roles that actually take text', () => {
    for (const role of ['AXTextField', 'AXTextArea', 'AXComboBox', 'AXSearchField']) {
      expect(caps(role).typeText, role).toBe(true)
    }
  })

  it('offers typing on a settable group, which is how contenteditable appears', () => {
    // Chromium exposes <div contenteditable> as a settable AXGroup, and an empty
    // one carries no value — `settable` is the only evidence it takes text.
    expect(caps('AXGroup', { settable: true }).typeText).toBe(true)
    expect(caps('AXGroup', { settable: true }).setText).toBe(true)
  })

  it('does not invent capabilities on a container that is not settable', () => {
    expect(caps('AXGroup').typeText).toBe(false)
    expect(caps('AXWebArea').setText).toBe(false)
  })

  it('keeps setText on a real control whose value is writable', () => {
    // A radio button's AXValue is its selection state; a slider's is a number.
    expect(caps('AXRadioButton', { settable: true }).setText).toBe(true)
    expect(caps('AXSlider', { settable: true }).setText).toBe(true)
  })
})
