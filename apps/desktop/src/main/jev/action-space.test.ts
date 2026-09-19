import { describe, expect, it } from 'vitest'
import { buildActionSpace, type HistoryEntry } from './action-space'
import { el, page } from './test-fixtures'

describe('buildActionSpace', () => {
  const elements = [
    el({ node: 1, role: 'link', label: 'Issues', href: 'https://github.com/x/issues' }),
    el({ node: 2, role: 'textbox', label: 'Title', editable: true }),
    el({ node: 3, role: 'textbox', label: 'Password', editable: false, password: true }),
    el({ node: 4, role: 'button', label: 'Create', submit: true }),
    el({ node: 5, role: 'link', label: 'Docs', href: 'https://docs.example.com/' }),
  ]

  it('offers every actionable element — risk is Jev\'s call — except password fields', () => {
    const space = buildActionSpace({ page: page(elements), history: [] })
    expect(space.clickCandidates).toEqual(['1', 'open:2', '4', '5'])
    expect(space.typeCandidates).toEqual(['2'])
    expect(space.elements.map((e) => e.index)).toEqual(['1', '2', '3', '4', '5'])
    expect(space.canScrollDown).toBe(true)
    expect(space.canScrollUp).toBe(false)
  })

  it('offers Enter in a filled field and skips disabled or unclickable elements', () => {
    const filled = [
      el({ node: 2, role: 'textbox', label: 'Search packages', editable: true, value: 'zod' }),
      el({ node: 3, role: 'textbox', label: 'Empty', editable: true }),
      el({ node: 4, role: 'button', label: 'Off', disabled: true }),
      el({ node: 5, role: 'staticText', label: 'Hint', clickable: false }),
    ]
    const space = buildActionSpace({ page: page(filled), history: [] })
    expect(space.clickCandidates).toEqual(['open:1', 'submit:1', 'open:2'])
    expect(space.typeCandidates).toEqual(['1', '2'])
  })

  it('withholds a candidate that did nothing since the page last changed, per intent', () => {
    const history: HistoryEntry[] = [{ node: 1, kind: 'click', label: 'Click Issues', changedPage: false }]
    const space = buildActionSpace({ page: page(elements), history })
    expect(space.clickCandidates).toEqual(['open:2', '4', '5'])

    const filled = [el({ node: 2, role: 'textbox', label: 'Search', editable: true, value: 'zod' })]
    const pressed: HistoryEntry = { node: 2, kind: 'submit', label: 'Press Enter', changedPage: false }
    expect(buildActionSpace({ page: page(filled), history: [pressed] }).clickCandidates).toEqual(['open:1'])

    const later: HistoryEntry = { node: 4, kind: 'click', label: 'Click Create', changedPage: true }
    expect(buildActionSpace({ page: page(elements), history: [history[0], later] }).clickCandidates).toEqual(['1', 'open:2', '4', '5'])
  })
})
