import { describe, expect, it } from 'vitest'
import { compactOutline, dropOccludedWebAreas } from '../outline-compact'
import { foldOutline } from '../outline'
import type { UiOutlineNode } from '../types'

const NO_CAPS = { press: false, setText: false, typeText: false, scroll: false, focus: false }
const PRESS = { ...NO_CAPS, press: true }

function node(
  ref: string,
  role: string,
  extra: Partial<UiOutlineNode> = {},
): UiOutlineNode {
  return { ref, role, capabilities: NO_CAPS, ...extra }
}

/** Flatten to `ref role "name"` lines so a whole shape reads in one assertion. */
function shape(root: UiOutlineNode): string[] {
  const out: string[] = []
  const walk = (n: UiOutlineNode, depth: number): void => {
    out.push(`${'  '.repeat(depth)}${n.ref} ${n.role} "${n.name ?? ''}"`)
    for (const c of n.children ?? []) walk(c, depth + 1)
  }
  walk(root, 0)
  return out
}

/** Depth-first list of every node, used by the safety assertions. */
function flattenAll(n: UiOutlineNode): UiOutlineNode[] {
  return [n, ...(n.children ?? []).flatMap(flattenAll)]
}

describe('compactOutline', () => {
  it('collapses a link whose label sits two wrappers below it', () => {
    // The shape Chromium emits for every sidebar entry: three rows, one control.
    const root = node('@e1', 'window', {
      children: [
        node('@e85', 'link', {
          capabilities: PRESS,
          children: [
            node('@e86', 'group', {
              capabilities: PRESS,
              children: [node('@e87', 'staticText', { value: '我的 Kimi' })],
            }),
          ],
        }),
      ],
    })
    expect(shape(compactOutline(root))).toEqual([
      '@e1 window ""',
      '  @e85 link "我的 Kimi"',
    ])
  })

  it('leaves a control alone when its subtree holds more than one label', () => {
    const root = node('@e1', 'window', {
      children: [
        node('@e2', 'group', {
          capabilities: PRESS,
          children: [
            node('@e3', 'staticText', { value: '快速' }),
            node('@e4', 'staticText', { value: '进阶' }),
          ],
        }),
      ],
    })
    expect(shape(compactOutline(root))).toHaveLength(4)
  })

  it('never hides a named control inside a promoted node', () => {
    const root = node('@e1', 'window', {
      children: [
        node('@e2', 'group', {
          capabilities: PRESS,
          children: [node('@e3', 'button', { name: 'Upgrade', capabilities: PRESS })],
        }),
      ],
    })
    expect(shape(compactOutline(root))).toContain('    @e3 button "Upgrade"')
  })

  it('drops unnamed layout groups that carry no capability at all', () => {
    const root = node('@e1', 'window', {
      children: [
        node('@e2', 'group', {
          children: [node('@e3', 'group', { children: [node('@e4', 'button', { name: 'Go', capabilities: PRESS })] })],
        }),
      ],
    })
    expect(shape(compactOutline(root))).toEqual(['@e1 window ""', '  @e4 button "Go"'])
  })

  it('drops a sole wrapper child whose press just forwards its parent\'s', () => {
    const root = node('@e1', 'window', {
      children: [
        node('@e2', 'group', {
          capabilities: PRESS,
          children: [node('@e3', 'group', { capabilities: PRESS, children: [node('@e4', 'image')] })],
        }),
      ],
    })
    // @e3 forwards, @e4 is decoration — one actionable row survives.
    expect(shape(compactOutline(root))).toEqual(['@e1 window ""', '  @e2 group ""'])
  })

  it('drops a static label that only repeats its parent', () => {
    const root = node('@e1', 'window', {
      children: [
        node('@e2', 'button', {
          name: 'Kimi Claw',
          capabilities: PRESS,
          children: [node('@e3', 'staticText', { value: 'Kimi Claw' })],
        }),
      ],
    })
    expect(shape(compactOutline(root))).toEqual(['@e1 window ""', '  @e2 button "Kimi Claw"'])
  })

  it('keeps a static label that says something the parent does not', () => {
    const root = node('@e1', 'window', {
      children: [
        node('@e2', 'button', {
          name: '25 25',
          capabilities: PRESS,
          children: [node('@e3', 'staticText', { value: '升级' })],
        }),
      ],
    })
    expect(shape(compactOutline(root))).toHaveLength(3)
  })

  it('drops images that carry neither a label nor an action', () => {
    const root = node('@e1', 'window', {
      children: [node('@e2', 'image'), node('@e3', 'image', { name: 'Avatar' })],
    })
    expect((compactOutline(root).children ?? []).map((c) => c.ref)).toEqual(['@e3'])
  })

  it('keeps every @eN ref it emits pointing at the same element', () => {
    // Refs are helper DFS indices; compaction may drop rows but must never
    // renumber the survivors, or ax_action resolves the wrong element.
    const root = node('@e1', 'window', {
      children: [
        node('@e2', 'group', { children: [node('@e7', 'button', { name: 'Go', capabilities: PRESS })] }),
        node('@e9', 'image'),
        node('@e11', 'button', { name: 'Stop', capabilities: PRESS }),
      ],
    })
    expect(shape(compactOutline(root))).toEqual([
      '@e1 window ""',
      '  @e7 button "Go"',
      '  @e11 button "Stop"',
    ])
  })

  it('never dissolves the root, however anonymous it looks', () => {
    const root = node('@e1', 'group', { children: [node('@e2', 'button', { name: 'Go', capabilities: PRESS })] })
    expect(compactOutline(root).ref).toBe('@e1')
  })

  it('does not count compacted rows as budget-omitted', () => {
    const root = node('@e1', 'window', {
      children: [node('@e2', 'group', { children: [node('@e3', 'button', { name: 'Go', capabilities: PRESS })] })],
    })
    expect(foldOutline(compactOutline(root)).nodesOmitted).toBe(0)
  })
})

describe('dropOccludedWebAreas', () => {
  const web = (ref: string, name: string, extra: Partial<UiOutlineNode> = {}): UiOutlineNode => ({
    ref,
    role: 'webArea',
    name,
    bounds: { x: 0, y: 0, width: 1300, height: 800 },
    capabilities: NO_CAPS,
    ...extra,
  })

  it('keeps only the web area that holds the application-level focus', () => {
    // Electron stacks one WebContentsView per page at identical bounds; all but
    // one are off screen, and the model cannot tell which by looking at the tree.
    const root = node('@e1', 'window', {
      children: [
        web('@e8', 'Background page', { children: [node('@e9', 'button', { name: 'Stale', capabilities: PRESS })] }),
        web('@e66', 'Visible page', {
          children: [node('@e67', 'textField', { appFocused: true, capabilities: PRESS })],
        }),
      ],
    })
    const kept = dropOccludedWebAreas(root).children ?? []
    expect(kept.map((c) => c.ref)).toEqual(['@e66'])
  })

  it('keeps every web area when focus is nowhere in one of them', () => {
    // Focus sits in native chrome, or the window was never clicked into. Dropping
    // on a guess would delete the page the person is actually looking at.
    const root = node('@e1', 'window', {
      children: [web('@e8', 'One'), web('@e66', 'Two')],
    })
    expect(dropOccludedWebAreas(root).children).toHaveLength(2)
  })

  it('leaves web areas at different bounds alone', () => {
    // Genuinely side-by-side views, both on screen.
    const root = node('@e1', 'window', {
      children: [
        web('@e8', 'Left', { bounds: { x: 0, y: 0, width: 650, height: 800 } }),
        web('@e66', 'Right', {
          bounds: { x: 650, y: 0, width: 650, height: 800 },
          children: [node('@e67', 'textField', { appFocused: true })],
        }),
      ],
    })
    expect(dropOccludedWebAreas(root).children).toHaveLength(2)
  })

  it('finds stacked web areas even when they are not siblings', () => {
    const root = node('@e1', 'window', {
      children: [
        node('@e2', 'group', { children: [web('@e8', 'Background')] }),
        node('@e3', 'group', {
          children: [web('@e66', 'Visible', { children: [node('@e67', 'button', { appFocused: true })] })],
        }),
      ],
    })
    const groups = dropOccludedWebAreas(root).children ?? []
    expect(groups[0].children ?? []).toHaveLength(0)
    expect((groups[1].children ?? []).map((c) => c.ref)).toEqual(['@e66'])
  })

  it('does nothing when there is only one web area', () => {
    const root = node('@e1', 'window', { children: [web('@e8', 'Only')] })
    expect(dropOccludedWebAreas(root).children).toHaveLength(1)
  })
})

describe('compaction safety invariants', () => {
  /** The shape Chromium actually emits, condensed: nested forwarding presses,
   *  labels parked in leaves, decorations, and one genuinely unnamed icon button. */
  const realistic: UiOutlineNode = {
    ref: '@e1',
    role: 'window',
    name: 'App',
    bounds: { x: 0, y: 0, width: 1300, height: 800 },
    capabilities: NO_CAPS,
    children: [
      {
        ref: '@e2',
        role: 'group',
        bounds: { x: 0, y: 0, width: 240, height: 800 },
        capabilities: PRESS,
        children: [
          {
            ref: '@e3',
            role: 'link',
            bounds: { x: 8, y: 8, width: 224, height: 40 },
            capabilities: PRESS,
            children: [
              {
                ref: '@e4',
                role: 'group',
                bounds: { x: 8, y: 8, width: 224, height: 40 },
                capabilities: PRESS,
                children: [
                  { ref: '@e5', role: 'image', bounds: { x: 16, y: 18, width: 20, height: 20 }, capabilities: NO_CAPS },
                  { ref: '@e6', role: 'staticText', value: 'Inbox', bounds: { x: 44, y: 20, width: 56, height: 16 }, capabilities: NO_CAPS },
                ],
              },
            ],
          },
          // No label anywhere: the only way to reach this is by its own rect.
          { ref: '@e7', role: 'button', bounds: { x: 200, y: 8, width: 24, height: 24 }, capabilities: PRESS },
        ],
      },
    ],
  }

  const flatten = (n: UiOutlineNode): UiOutlineNode[] => [n, ...(n.children ?? []).flatMap(flatten)]
  const isActionable = (n: UiOutlineNode) =>
    !!(n.capabilities?.press || n.capabilities?.setText || n.capabilities?.typeText)
  const textOf = (n: UiOutlineNode) => (n.name || n.value || '').trim()
  const contains = (outer: UiOutlineNode, inner: UiOutlineNode) => {
    const a = outer.bounds, b = inner.bounds
    if (!a || !b) return false
    return a.x <= b.x && a.y <= b.y && a.x + a.width >= b.x + b.width && a.y + a.height >= b.y + b.height
  }

  const before = flatten(realistic)
  const after = flatten(compactOutline(realistic))
  const kept = new Set(after.map((n) => n.ref))

  it('never drops a control that carries its own label', () => {
    const lost = before.filter((n) => isActionable(n) && textOf(n) && !kept.has(n.ref))
    expect(lost.map((n) => `${n.ref} ${textOf(n)}`)).toEqual([])
  })

  it('never drops a piece of text out of the tree entirely', () => {
    const surviving = new Set(after.map(textOf).filter(Boolean))
    const lost = [...new Set(before.map(textOf).filter(Boolean))].filter((t) => !surviving.has(t))
    expect(lost).toEqual([])
  })

  it('only ever drops wrapper-role nodes among unnamed controls', () => {
    // The principled invariant. Rect containment is too weak on its own: a
    // sidebar-sized group "covers" a 24px icon button while being useless as a
    // substitute for pressing it.
    const dropped = before.filter((n) => isActionable(n) && !textOf(n) && !kept.has(n.ref))
    expect(dropped.filter((n) => !['group', 'unknown'].includes(n.role)).map((n) => n.ref)).toEqual([])
  })

  it('leaves every dropped unnamed control covered by one that survived', () => {
    const targets = after.filter(isActionable)
    const dropped = before.filter((n) => isActionable(n) && !textOf(n) && !kept.has(n.ref))
    const uncovered = dropped.filter((d) => !targets.some((t) => t.ref !== d.ref && contains(t, d)))
    expect(uncovered.map((n) => n.ref)).toEqual([])
  })

  it('keeps the unnamed icon button that nothing else stands in for', () => {
    expect(kept.has('@e7')).toBe(true)
  })
})


describe('promotion across a branching subtree', () => {
  it('refuses to promote when two branches each carry a press target', () => {
    // Folding a chain loses nothing. Folding a fork loses whichever branch did
    // not supply the label — here @e5, an unnamed clickable with no other row.
    const root = node('@e1', 'window', {
      children: [
        node('@e2', 'group', {
          capabilities: PRESS,
          children: [
            node('@e3', 'group', {
              capabilities: PRESS,
              children: [node('@e4', 'staticText', { value: 'Inbox' })],
            }),
            node('@e5', 'group', { capabilities: PRESS }),
          ],
        }),
      ],
    })
    const refs = new Set(flattenAll(compactOutline(root)).map((n) => n.ref))
    expect(refs.has('@e5')).toBe(true)
  })

  it('still folds a straight chain of forwarding wrappers', () => {
    const root = node('@e1', 'window', {
      children: [
        node('@e2', 'link', {
          capabilities: PRESS,
          children: [
            node('@e3', 'group', {
              capabilities: PRESS,
              children: [
                node('@e4', 'group', {
                  capabilities: PRESS,
                  children: [node('@e5', 'staticText', { value: 'PPT' })],
                }),
              ],
            }),
          ],
        }),
      ],
    })
    expect(shape(compactOutline(root))).toEqual(['@e1 window ""', '  @e2 link "PPT"'])
  })

  it('still folds a control whose siblings are only decoration and a label', () => {
    const root = node('@e1', 'window', {
      children: [
        node('@e2', 'group', {
          capabilities: PRESS,
          children: [node('@e3', 'image'), node('@e4', 'staticText', { value: 'Upgrade plan' })],
        }),
      ],
    })
    expect(shape(compactOutline(root))).toEqual(['@e1 window ""', '  @e2 group "Upgrade plan"'])
  })

  it('keeps a node that currently holds keyboard focus', () => {
    const root = node('@e1', 'window', {
      children: [
        node('@e2', 'group', {
          capabilities: PRESS,
          children: [
            node('@e3', 'group', {
              focused: true,
              capabilities: { ...NO_CAPS, focus: true },
              children: [node('@e4', 'staticText', { value: 'Label' })],
            }),
          ],
        }),
      ],
    })
    const refs = new Set(flattenAll(compactOutline(root)).map((n) => n.ref))
    expect(refs.has('@e3')).toBe(true)
  })
})

describe('dropOccludedWebAreas with nested web areas', () => {
  const B = { x: 0, y: 0, width: 1300, height: 800 }

  it('never treats a nested iframe as a page stacked behind its host', () => {
    // A full-bleed iframe reports the same bounds as its host document. It is
    // inside the visible page, not an alternative to it.
    const root = node('@e1', 'window', {
      bounds: B,
      children: [
        node('@e2', 'webArea', {
          name: 'Host page',
          bounds: B,
          children: [
            node('@e3', 'button', { name: 'Toolbar', appFocused: true, capabilities: PRESS }),
            node('@e4', 'webArea', {
              name: 'Embedded iframe',
              bounds: B,
              children: [node('@e5', 'button', { name: 'Inside iframe', capabilities: PRESS })],
            }),
          ],
        }),
      ],
    })
    const refs = new Set(flattenAll(dropOccludedWebAreas(root)).map((n) => n.ref))
    expect(refs.has('@e4')).toBe(true)
    expect(refs.has('@e5')).toBe(true)
  })

  it('still drops a true sibling stack', () => {
    const root = node('@e1', 'window', {
      bounds: B,
      children: [
        node('@e2', 'webArea', { name: 'Background', bounds: B }),
        node('@e3', 'webArea', {
          name: 'Visible',
          bounds: B,
          children: [node('@e4', 'textField', { appFocused: true, capabilities: PRESS })],
        }),
      ],
    })
    expect((dropOccludedWebAreas(root).children ?? []).map((c) => c.ref)).toEqual(['@e3'])
  })
})

describe('what promotion can and cannot prove', () => {
  /**
   * Topology cannot prove that two presses on one chain are the same action.
   * A named press is never folded away, so these two tests pin both sides of
   * where the guarantee stops.
   */
  const chain = (innerName?: string): UiOutlineNode =>
    node('@e1', 'window', {
      children: [
        node('@e2', 'group', {
          capabilities: PRESS,
          children: [
            node('@e3', 'group', {
              capabilities: PRESS,
              children: [
                node('@e4', 'group', {
                  ...(innerName ? { name: innerName } : {}),
                  capabilities: PRESS,
                  children: [node('@e5', 'staticText', { value: 'More' })],
                }),
              ],
            }),
          ],
        }),
      ],
    })

  it('keeps a nested action that names itself', () => {
    const refs = new Set(flattenAll(compactOutline(chain('Open menu'))).map((n) => n.ref))
    expect(refs.has('@e4')).toBe(true)
  })

  it('known limitation: an unnamed nested action on the same chain is folded away', () => {
    // If @e4 were a distinct "more" menu rather than padding, this would lose
    // it. Accepted deliberately, and it is a trade rather than a safe case: an
    // unnamed control is still reachable by role, as the unnamed 24px icon
    // button above shows. What narrows the risk is only that such a node is
    // more likely an accessibility defect in the app than a distinct target,
    // and that requiring equal bounds along the chain would block promotion on
    // 16 of the 27 chains measured in a real Chromium window.
    const refs = new Set(flattenAll(compactOutline(chain())).map((n) => n.ref))
    expect(refs.has('@e4')).toBe(false)
    expect(compactOutline(chain()).children?.[0]?.name).toBe('More')
  })
})
