import { describe, expect, it } from 'vitest'
import { cn } from './utils'

describe('cn', () => {
  it('merges tailwind classes and keeps the last conflicting value', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4')
  })

  it('handles falsy inputs while composing class names', () => {
    expect(cn('font-semibold', undefined, false && 'hidden', 'text-sm')).toBe('font-semibold text-sm')
  })
})
