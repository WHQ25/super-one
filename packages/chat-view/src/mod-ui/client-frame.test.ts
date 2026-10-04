import { describe, expect, it } from 'vitest'
import { clientFrameDocument, clientKeyEvent, clientPointerEvent, importClientTree } from './client-frame'

const LIMITS = { nodes: 20000, depth: 32, chars: 100000, values: 20000, dataDepth: 32 }

describe('importClientTree', () => {
  it('turns held handles into press refs owned by the Client plugin', () => {
    const text = JSON.stringify({
      type: 'Box',
      props: { flexDirection: 'column' },
      children: [{ type: 'Text', children: ['client ticks 3'] }, { type: 'Button', props: { key: 'client-btn', label: 'client press' }, held: 7 }],
    })
    const imported = importClientTree(text, 'probe-mod', LIMITS)
    expect(imported).toEqual({
      tree: {
        type: 'Box',
        props: { flexDirection: 'column' },
        children: [
          { type: 'Text', props: {}, children: ['client ticks 3'] },
          { type: 'Button', props: { key: 'client-btn', label: 'client press' }, press: { plugin: 'probe-mod', handle: 7 } },
        ],
      },
      handles: [7],
    })
  })

  it('refuses what a surface module may not draw and what passes the limits', () => {
    const fault = (tree: unknown, limits = LIMITS) => 'fault' in importClientTree(JSON.stringify(tree), 'p', limits)
    expect(fault({ type: 'Client', props: { key: 'c', module: 'x' } })).toBe(true)
    expect(fault({ type: 'engine', ref: 1 })).toBe(true)
    expect(fault({ type: 'Svg', props: { source: '<svg/>', alt: '' } })).toBe(true)
    expect(fault({ type: 'Button', props: { key: 'b', label: 'x' } })).toBe(true)
    expect(fault({ type: 'Box', children: [{ type: 'Text' }, { type: 'Text' }] }, { ...LIMITS, nodes: 2 })).toBe(true)
    expect('fault' in importClientTree('x'.repeat(11), 'p', { ...LIMITS, chars: 10 })).toBe(true)
    expect('fault' in importClientTree('{', 'p', LIMITS)).toBe(true)
  })
})

describe('clientFrameDocument', () => {
  it('allows only its own nonce and blob modules, and cannot be closed early by a source', () => {
    const doc = clientFrameDocument(
      { bundle: { plugin: 'p', hash: 'h', modules: [], runtime: 'r', limits: LIMITS, files: [{ key: 'r', source: '</script><script>alert(1)</script>' }] }, module: 'm', props: null, columns: 10, rows: 2 },
      'abc',
    )
    expect(doc).toContain(`content="default-src 'none'; script-src 'nonce-abc' blob:"`)
    expect(doc.match(/<script/g)).toHaveLength(2)
    expect(doc).not.toContain('</script><script>alert')
  })
})

describe('events', () => {
  it('names keys as the terminal does', () => {
    const key = (k: string, mods: Partial<{ ctrlKey: boolean; shiftKey: boolean; metaKey: boolean }> = {}) =>
      clientKeyEvent({ key: k, ctrlKey: false, shiftKey: false, metaKey: false, ...mods })
    expect(key('ArrowUp')).toEqual({ key: 'up' })
    expect(key('Enter')).toEqual({ key: 'return' })
    expect(key(' ')).toEqual({ key: 'space' })
    expect(key('a', { ctrlKey: true })).toEqual({ key: 'a', ctrl: true })
    expect(key('Shift', { shiftKey: true })).toBeNull()
  })

  it('places a pointer in the Client cells', () => {
    const e = { clientX: 115, clientY: 241, button: 2, shiftKey: true, altKey: false, ctrlKey: false }
    expect(clientPointerEvent('down', e, { left: 100, top: 200 }, { width: 7, height: 18 })).toEqual({ type: 'down', x: 2, y: 2, button: 'right', shift: true })
    expect(clientPointerEvent('move', e, { left: 100, top: 200 }, { width: 7, height: 18 })).toEqual({ type: 'move', x: 2, y: 2, shift: true })
  })
})
