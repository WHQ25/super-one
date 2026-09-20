import { describe, it, expect } from 'vitest'
import {
  collectRefs,
  diffOutlines,
  expandSubtree,
  findNode,
  foldOutline,
  searchOutline,
} from '../outline'
import type { UiOutlineNode } from '../types'

function tree(): UiOutlineNode {
  return {
    ref: '@e1',
    role: 'window',
    name: 'Root',
    children: [
      {
        ref: '@e2',
        role: 'group',
        name: 'Sidebar',
        children: [
          { ref: '@e3', role: 'button', name: 'Save' },
          { ref: '@e4', role: 'button', name: 'Saved items' },
        ],
      },
      {
        ref: '@e5',
        role: 'textField',
        name: 'Title',
        value: 'Draft',
      },
    ],
  }
}

describe('outline helpers', () => {
  it('default fold reaches web content, not just the wrapper chain', () => {
    // Shape of a real Electron window after the helper elides anonymous
    // wrappers: chrome, then the web area, then the actual controls. A depth-2
    // default used to stop above the webArea and hand the model empty groups.
    let node: UiOutlineNode = { ref: '@e42', role: 'button', name: 'New Session' }
    for (const [ref, role] of [
      ['@e13', 'tabGroup'],
      ['@e12', 'group'],
      ['@e11', 'group'],
      ['@e9', 'webArea'],
      ['@e2', 'group'],
      ['@e1', 'window'],
    ] as const) {
      node = { ref, role, children: [node] }
    }

    const { outline } = foldOutline(node)

    expect(findNode(outline, '@e42')?.name).toBe('New Session')
  })

  it('folds deep trees and reports omitted nodes', () => {
    const { outline, nodesOmitted, maxDepth } = foldOutline(tree(), {
      maxDepth: 1,
      maxNodes: 100,
    })
    expect(maxDepth).toBe(1)
    expect(outline.children?.length).toBe(2)
    // children of group are omitted at depth 1
    expect(outline.children?.[0]?.children).toBeUndefined()
    expect(nodesOmitted).toBeGreaterThan(0)
  })

  it('respects maxNodes budget', () => {
    const { outline, nodesOmitted } = foldOutline(tree(), { maxDepth: 10, maxNodes: 2 })
    expect(outline.ref).toBe('@e1')
    expect(nodesOmitted).toBeGreaterThan(0)
  })

  it('search ranks exact before prefix before substring', () => {
    const hits = searchOutline(tree(), 'Save')
    expect(hits[0]?.name).toBe('Save')
    expect(hits.some((h) => h.name === 'Saved items')).toBe(true)
  })

  it('find / expand / collect / diff', () => {
    const t = tree()
    expect(findNode(t, '@e5')?.value).toBe('Draft')
    const sub = expandSubtree(t, '@e2', 1)!
    expect(sub.children?.map((c) => c.name)).toEqual(['Save', 'Saved items'])
    expect(collectRefs(t)).toContain('@e4')

    const after: UiOutlineNode = {
      ...t,
      children: [
        t.children![0]!,
        { ref: '@e5', role: 'textField', name: 'Title', value: 'Final' },
        { ref: '@e6', role: 'button', name: 'New' },
      ],
    }
    const d = diffOutlines(t, after)
    expect(d.added).toContain('@e6')
    expect(d.changed.some((c) => c.ref === '@e5' && c.to === 'Final')).toBe(true)
  })

  it('diffs nodes by what they are, so one inserted node does not shift the rest', () => {
    // TextEdit's title bar gains an "Edited" label on the first keystroke;
    // every ref after it moves by one, and a ref-keyed diff reported the
    // whole menu bar as renamed while the typed text was the one real change.
    const before: UiOutlineNode = { ref: '@e1', role: 'window', name: 'Untitled', children: [
      { ref: '@e2', role: 'group', children: [{ ref: '@e3', role: 'staticText', name: 'Untitled' }] },
      { ref: '@e4', role: 'textArea', value: 'Jev' },
      { ref: '@e5', role: 'menuBar', children: [
        { ref: '@e6', role: 'menuBarItem', name: 'Apple' }, { ref: '@e7', role: 'menuBarItem', name: 'File' },
      ] },
    ] }
    const after: UiOutlineNode = { ref: '@e1', role: 'window', name: 'Untitled', children: [
      { ref: '@e2', role: 'group', children: [
        { ref: '@e3', role: 'staticText', name: 'Edited' }, { ref: '@e4', role: 'staticText', name: 'Untitled' },
      ] },
      { ref: '@e5', role: 'textArea', value: 'Jev typed' },
      { ref: '@e6', role: 'menuBar', children: [
        { ref: '@e7', role: 'menuBarItem', name: 'Apple' }, { ref: '@e8', role: 'menuBarItem', name: 'File' },
      ] },
    ] }
    const d = diffOutlines(before, after)
    expect(d.added).toEqual(['@e3'])
    expect(d.removed).toEqual([])
    expect(d.changed).toEqual([{ ref: '@e5', field: 'value', from: 'Jev', to: 'Jev typed' }])
    // A label whose text changed is still the same label, not a swap.
    const relabelled: UiOutlineNode = { ...before, children: [
      { ref: '@e2', role: 'group', children: [{ ref: '@e3', role: 'staticText', name: 'Untitled 2' }] },
      ...before.children!.slice(1),
    ] }
    expect(diffOutlines(before, relabelled)).toMatchObject({ added: [], removed: [],
      changed: [{ ref: '@e3', field: 'name', from: 'Untitled', to: 'Untitled 2' }] })
  })
})

