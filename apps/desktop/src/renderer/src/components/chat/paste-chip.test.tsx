import { pasteSummary } from './paste-chip'

describe('pasteSummary', () => {
  it('collapses lines and whitespace into one line', () => {
    expect(pasteSummary('  first line\n\n\tsecond   line \n')).toBe('first line second line')
  })

  it('cuts long text at 40 characters with an ellipsis', () => {
    expect(pasteSummary('x'.repeat(60))).toBe(`${'x'.repeat(40)}…`)
  })

  it('never splits a surrogate pair', () => {
    expect(pasteSummary('😀'.repeat(41))).toBe(`${'😀'.repeat(40)}…`)
  })
})
