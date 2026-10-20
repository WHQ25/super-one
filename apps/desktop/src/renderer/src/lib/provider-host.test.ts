import { describe, expect, it } from 'vitest'
import { codexProjectForScope, subscriptionHost } from './provider-host'

describe('subscriptionHost', () => {
  it('uses the project machine, and the sidebar host only when no project is open', () => {
    expect(subscriptionHost('remote:desk:/work', 'local')).toBe('desk')
    expect(subscriptionHost('/work', 'desk')).toBeNull()
    expect(subscriptionHost(null, 'desk')).toBe('desk')
    expect(subscriptionHost(null, 'local')).toBeNull()
  })
})

describe('codexProjectForScope', () => {
  it('refuses a project that belongs to the other machine', () => {
    expect(codexProjectForScope('remote:desk:/work', 'desk')).toBe('remote:desk:/work')
    expect(codexProjectForScope('/work', 'desk')).toBeNull()
    expect(codexProjectForScope('remote:desk:/work', 'local')).toBeNull()
    expect(codexProjectForScope('/work', 'local')).toBe('/work')
  })
})
