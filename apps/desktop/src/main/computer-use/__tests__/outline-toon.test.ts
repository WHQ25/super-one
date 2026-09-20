import { describe, expect, it } from 'vitest'
import { outlineToRows, outlineToToon } from '../outline-toon'
import type { UiOutlineNode } from '../types'

function tree(): UiOutlineNode {
  return {
    ref: '@e1',
    role: 'window',
    name: 'Kimi',
    bounds: { x: 233, y: 136, width: 1300, height: 800 },
    enabled: true,
    focused: false,
    capabilities: { press: false, setText: false, typeText: false, scroll: false, focus: true },
    children: [
      {
        ref: '@e13',
        role: 'tabGroup',
        capabilities: { press: false, setText: false, typeText: false, scroll: false, focus: false },
        children: [
          {
            ref: '@e14',
            role: 'radioButton',
            name: 'Work',
            value: '1',
            bounds: { x: 243, y: 186, width: 110, height: 32 },
            enabled: true,
            focused: true,
            capabilities: { press: true, setText: false, typeText: false, scroll: false, focus: true },
          },
          {
            ref: '@e15',
            role: 'radioButton',
            name: 'Chat',
            value: '0',
            enabled: false,
            capabilities: { press: true, setText: false, typeText: false, scroll: false, focus: false },
          },
        ],
      },
    ],
  }
}

describe('outline-toon', () => {
  it('flattens depth-first and records nesting as a depth column', () => {
    const rows = outlineToRows(tree())
    expect(rows.map((r) => [r.ref, r.depth])).toEqual([
      ['@e1', 0],
      ['@e13', 1],
      ['@e14', 2],
      ['@e15', 2],
    ])
  })

  it('lists only supported capabilities, so inert nodes cost nothing', () => {
    const rows = outlineToRows(tree())
    expect(rows[0]!.can).toBe('focus')
    expect(rows[1]!.can).toBe('')
    expect(rows[2]!.can).toBe('press|focus')
  })

  it('lists only non-default state flags', () => {
    const rows = outlineToRows(tree())
    expect(rows[0]!.state).toBe('')
    expect(rows[2]!.state).toBe('focused')
    expect(rows[3]!.state).toBe('disabled')
  })

  it('shows a disclosure or menu item state, which its value column does not', () => {
    // Finder's disclosure triangle carries "0"/"1" in value; a chosen menu
    // command shows nothing but its check mark. The model reading the outline
    // needs the state named, not decoded from a digit.
    const t = tree()
    t.children![0]!.children!.push(
      { ref: '@e16', role: 'disclosureTriangle', value: '0', expanded: false },
      { ref: '@e17', role: 'menuItem', name: 'Date Modified', checked: true },
    )
    const rows = outlineToRows(t)
    expect(rows[4]!.state).toBe('collapsed')
    expect(rows[5]!.state).toBe('checked')
  })

  it('leaves a missing frame empty rather than collapsing it to 0,0', () => {
    // 0 is a real coordinate — emitting it for "no frame" would send a click
    // to the top-left corner of the capture.
    const rows = outlineToRows(tree())
    expect(rows[3]!.x).toBe('')
    expect(rows[3]!.w).toBe('')
    expect(rows[2]!.x).toBe(243)
  })

  it('encodes as a TOON table whose header names every column once', () => {
    const toon = outlineToToon(tree())
    const [header, ...body] = toon.split('\n')
    expect(header).toBe('outline[4]{ref,depth,role,name,value,x,y,w,h,can,state}:')
    expect(body).toHaveLength(4)
    expect(body[2]).toContain('@e14,2,radioButton,Work')
  })

  it('stays far cheaper than the nested JSON it replaces', () => {
    const outline = tree()
    expect(outlineToToon(outline).length).toBeLessThan(JSON.stringify(outline).length / 2)
  })
})
