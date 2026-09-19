import { describe, expect, it } from 'vitest'
import { buildActionSpace, classify, type HistoryEntry } from './action-space'
import { el, page } from './test-fixtures'

const origins = new Set(['https://github.com'])

describe('classify — safe is a whitelist', () => {
  it('keeps same-origin links safe and cross-origin links guarded', () => {
    expect(classify(el({ node: 1, role: 'link', label: 'Issues', href: 'https://github.com/x/issues' }), origins, []).risk).toBe('safe')
    expect(classify(el({ node: 2, role: 'link', label: 'Docs', href: 'https://docs.example.com/' }), origins, [])).toMatchObject({ risk: 'guarded', reason: 'cross-origin link' })
  })

  it('guards submit, unrecognised and unlabelled buttons, but not navigation-shaped ones', () => {
    expect(classify(el({ node: 1, role: 'button', label: 'Create', submit: true }), origins, [])).toMatchObject({ risk: 'guarded', highRisk: true })
    expect(classify(el({ node: 2, role: 'button', label: 'Do the thing' }), origins, []).reason).toBe('unrecognised button')
    expect(classify(el({ node: 3, role: 'button', label: '' }), origins, []).reason).toBe('unlabelled button')
    expect(classify(el({ node: 4, role: 'button', label: 'New issue' }), origins, []).risk).toBe('safe')
    expect(classify(el({ node: 5, role: 'button', label: 'Labels', expanded: 'false' }), origins, []).risk).toBe('safe')
  })

  it('treats a high-risk label as guarded even on a same-origin link, unless allowed', () => {
    const link = el({ node: 1, role: 'link', label: 'Delete repository', href: 'https://github.com/x/settings' })
    expect(classify(link, origins, []).risk).toBe('guarded')
    expect(classify(link, origins, ['delete repository']).risk).toBe('safe')
  })

  it('guards state toggles and keeps editable fields safe', () => {
    expect(classify(el({ node: 1, role: 'checkbox', label: 'Agree', checked: 'false' }), origins, []).reason).toBe('state toggle')
    expect(classify(el({ node: 2, role: 'textbox', label: 'Title', editable: true }), origins, []).risk).toBe('safe')
  })
})

describe('buildActionSpace', () => {
  const elements = [
    el({ node: 1, role: 'link', label: 'Issues', href: 'https://github.com/x/issues' }),
    el({ node: 2, role: 'textbox', label: 'Title', editable: true }),
    el({ node: 3, role: 'textbox', label: 'Password', editable: false, password: true }),
    el({ node: 4, role: 'button', label: 'Create', submit: true }),
    el({ node: 5, role: 'button', label: 'Create more' }),
  ]

  it('offers safe clicks, open candidates for fields, and lists guarded separately', () => {
    const space = buildActionSpace({ page: page(elements), origins, allow: [], avoid: [], history: [] })
    expect(space.clickCandidates).toEqual(['1', 'open:2'])
    expect(space.typeCandidates).toEqual(['2'])
    expect(space.guarded.map((g) => g.label)).toEqual(['Create', 'Create more'])
    expect(space.canScrollDown).toBe(true)
    expect(space.canScrollUp).toBe(false)
  })

  it('removes avoided labels entirely and moves allowed ones into the safe set', () => {
    const space = buildActionSpace({ page: page(elements), origins, allow: ['create'], avoid: ['Create more'], history: [] })
    expect(space.elements.map((e) => e.label)).not.toContain('Create more')
    expect(space.guarded).toHaveLength(0)
    expect(space.clickCandidates).toContain(space.elements.find((e) => e.label === 'Create')!.index)
  })

  it('withholds a guarded element that was executed without a page change, until the page changes', () => {
    const executed: HistoryEntry = { node: 4, kind: 'click', label: 'Click Create', changedPage: false, guarded: true }
    const withheld = buildActionSpace({ page: page(elements), origins, allow: [], avoid: [], history: [executed] })
    expect(withheld.guarded.map((g) => g.node)).toEqual([5])

    const later: HistoryEntry = { node: 1, kind: 'click', label: 'Click Issues', changedPage: true, guarded: false }
    const reset = buildActionSpace({ page: page(elements), origins, allow: [], avoid: [], history: [executed, later] })
    expect(reset.guarded.map((g) => g.node)).toEqual([4, 5])
  })

  it('withholds Enter in a filled field unless allowed by label or a bare "Enter"', () => {
    const filled = [el({ node: 2, role: 'textbox', label: 'Search packages', editable: true, value: 'zod' }), el({ node: 3, role: 'textbox', label: 'Empty', editable: true })]
    const held = buildActionSpace({ page: page(filled), origins, allow: [], avoid: [], history: [] })
    expect(held.clickCandidates).toEqual(['open:1', 'open:2'])
    expect(held.guardedSubmits.map((e) => e.node)).toEqual([2])

    const byLabel = buildActionSpace({ page: page(filled), origins, allow: ['search packages'], avoid: [], history: [] })
    expect(byLabel.clickCandidates).toContain('submit:1')
    const byEnter = buildActionSpace({ page: page(filled), origins, allow: ['Enter'], avoid: [], history: [] })
    expect(byEnter.clickCandidates).toContain('submit:1')
    expect(byEnter.guardedSubmits).toHaveLength(0)

    const pressed: HistoryEntry = { node: 2, kind: 'submit', label: 'Press Enter', changedPage: false, guarded: true }
    const stuck = buildActionSpace({ page: page(filled), origins, allow: ['Enter'], avoid: [], history: [pressed] })
    expect(stuck.clickCandidates).not.toContain('submit:1')
  })

  it('drops a safe candidate that did nothing on the previous step', () => {
    const history: HistoryEntry[] = [{ node: 1, kind: 'click', label: 'Click Issues', changedPage: false, guarded: false }]
    const space = buildActionSpace({ page: page(elements), origins, allow: [], avoid: [], history })
    expect(space.clickCandidates).toEqual(['open:2'])
  })
})
