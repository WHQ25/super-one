import { describe, it, expect } from 'vitest'
import { buildMiniAppUrlHost, NO_PROJECT_KEY } from './miniapp-url'

describe('buildMiniAppUrlHost', () => {
  it('builds host with appId and project UUID', () => {
    expect(buildMiniAppUrlHost('hello', 'f3a1b9c2-1234-5678-9abc-def012345678')).toBe(
      'hello.f3a1b9c2-1234-5678-9abc-def012345678',
    )
  })

  it('falls back to no-project key when projectId is null', () => {
    expect(buildMiniAppUrlHost('hello', null)).toBe(`hello.${NO_PROJECT_KEY}`)
  })

  it('falls back to no-project key when projectId is undefined', () => {
    expect(buildMiniAppUrlHost('hello', undefined)).toBe(`hello.${NO_PROJECT_KEY}`)
  })
})
