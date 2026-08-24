import { describe, expect, it } from 'vitest'
import { splitComputerResult, toonRowCount } from './computer-result-sections'

const OUTLINE = [
  'outline[3]{ref,depth,role,name,value,x,y,w,h,can,state}:',
  '  @e1,0,window,Kimi,"",0,0,1300,800,focus,""',
  '  @e13,7,radioButton,Work,"1",10,50,110,32,press,""',
  '  @e14,7,radioButton,Chat,"0",120,50,110,32,press,""',
].join('\n')

function snapshot(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    stateId: 'S1',
    root: { app: 'Kimi', bundleId: 'com.moonshot.kimichat', title: 'Kimi Agent' },
    outline: OUTLINE,
    truncation: { nodesOmitted: 0, maxDepth: 20 },
    mode: 'fused',
    ...extra,
  })
}

describe('toonRowCount', () => {
  it('reads the row count out of the TOON header', () => {
    expect(toonRowCount(OUTLINE)).toBe(3)
    expect(toonRowCount('no header here')).toBeUndefined()
  })
})

describe('splitComputerResult', () => {
  it('lifts the outline out of the envelope as a table', () => {
    const sections = splitComputerResult(snapshot())
    expect(sections?.tables).toHaveLength(1)
    expect(sections?.tables[0]).toMatchObject({ key: 'outline', rows: 3 })
    expect(sections?.envelope).not.toContain('outline[3]')
  })

  it('summarises the envelope as labelled fields instead of JSON', () => {
    const fields = splitComputerResult(snapshot())?.fields ?? []
    const byKey = Object.fromEntries(fields.map((f) => [f.labelKey, f.value]))
    expect(byKey.app).toBe('Kimi')
    expect(byKey.window).toBe('Kimi Agent')
    expect(byKey.nodes).toBe('3')
    expect(byKey.mode).toBe('fused')
    expect(byKey.state).toBe('S1')
  })

  it('omits the window field when it just repeats the app name', () => {
    const sections = splitComputerResult(
      snapshot({ root: { app: 'Kimi', title: 'Kimi' } }),
    )
    expect(sections?.fields.map((f) => f.labelKey)).not.toContain('window')
  })

  it('reports omitted nodes only when the outline was actually truncated', () => {
    const clean = splitComputerResult(snapshot())?.fields ?? []
    expect(clean.map((f) => f.labelKey)).not.toContain('omitted')
    const cut = splitComputerResult(snapshot({ truncation: { nodesOmitted: 855 } }))
    expect(cut?.fields.find((f) => f.labelKey === 'omitted')?.value).toBe('855')
  })

  it('still yields fields when the result carries no table at all', () => {
    const sections = splitComputerResult(
      JSON.stringify({ stateId: 'S2', outcome: 'worked', root: { app: 'Kimi' } }),
    )
    expect(sections?.tables).toHaveLength(0)
    expect(sections?.fields.find((f) => f.labelKey === 'outcome')?.value).toBe('worked')
  })

  it('returns null for payloads that are not a JSON object', () => {
    expect(splitComputerResult('APP_NOT_FOUND: no such app')).toBeNull()
    expect(splitComputerResult('[1,2,3]')).toBeNull()
  })
})

describe('splitComputerResult on non-snapshot shapes', () => {
  it('reads the successor state an act result reports', () => {
    const fields = splitComputerResult(
      JSON.stringify({
        outcome: 'worked',
        successorRoot: { app: 'Kimi', title: 'Kimi Agent' },
        successorStateId: 'S4',
      }),
    )?.fields ?? []
    const byKey = Object.fromEntries(fields.map((f) => [f.labelKey, f.value]))
    expect(byKey).toMatchObject({ app: 'Kimi', window: 'Kimi Agent', state: 'S4', outcome: 'worked' })
  })

  it('treats status as a wait verdict only when it is one', () => {
    const verdict = splitComputerResult(JSON.stringify({ status: 'verified' }))?.fields
    expect(verdict?.find((f) => f.labelKey === 'waitStatus')?.value).toBe('verified')
    const unrelated = splitComputerResult(JSON.stringify({ status: 'ok' }))?.fields
    expect(unrelated?.map((f) => f.labelKey)).not.toContain('waitStatus')
  })

  it('counts query matches', () => {
    const fields = splitComputerResult(
      JSON.stringify({ root: { app: 'Kimi' }, matches: [{ ref: '@e1' }, { ref: '@e2' }] }),
    )?.fields
    expect(fields?.find((f) => f.labelKey === 'matches')?.value).toBe('2')
  })
})
