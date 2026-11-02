import { describe, expect, it } from 'vitest'
import { collapsedPhoneStacksDelivery } from './composer-frame'

const oneLine = {
  collapsed: true,
  hasStop: true,
  hasDelivery: true,
  draft: '短草稿',
  measuredWidth: 220,
  measuredLines: 1,
}

describe('collapsedPhoneStacksDelivery', () => {
  it('keeps a one-line draft beside Send', () => {
    expect(collapsedPhoneStacksDelivery(oneLine)).toBe(false)
  })

  it('stacks when the field wraps at the width Send still occupies', () => {
    expect(collapsedPhoneStacksDelivery({ ...oneLine, measuredLines: 2 })).toBe(true)
  })

  it('stacks on a hard break before the field has been measured', () => {
    expect(collapsedPhoneStacksDelivery({ ...oneLine, draft: '第一行\n第二行', measuredWidth: 0, measuredLines: 1 })).toBe(true)
  })

  it('ignores a stale line count until the narrow width is known', () => {
    expect(collapsedPhoneStacksDelivery({ ...oneLine, measuredWidth: 0, measuredLines: 4 })).toBe(false)
  })

  it('leaves the keyboard-up row, a phone without Stop, and an empty delivery alone', () => {
    expect(collapsedPhoneStacksDelivery({ ...oneLine, collapsed: false, measuredLines: 3 })).toBe(false)
    expect(collapsedPhoneStacksDelivery({ ...oneLine, hasStop: false, draft: '第一行\n第二行' })).toBe(false)
    expect(collapsedPhoneStacksDelivery({ ...oneLine, hasDelivery: false, measuredLines: 3 })).toBe(false)
  })
})
