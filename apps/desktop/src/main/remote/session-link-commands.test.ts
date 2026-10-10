import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ list: vi.fn(), metadata: vi.fn(), target: vi.fn() }))
vi.mock('../environment/environment-host', () => ({ getEnvironmentHost: () => ({ listEnvironments: mocks.list }) }))
vi.mock('../environment/session-links', () => ({ sessionLinkMetadata: mocks.metadata, resolveSessionLinkTarget: mocks.target }))
import { readPhoneEnvironments, readPhoneSessionLinkMetadata, readPhoneSessionLinkTarget } from './session-link-commands'

describe('native phone session links', () => {
  it('returns authenticated descriptors and aliases for environment selection', async () => {
    const environments = [{ environmentId: 'env', environmentAliases: ['old'], kind: 'local', capabilities: { methods: ['session.load'] } }]
    mocks.list.mockResolvedValue(environments)
    expect(await readPhoneEnvironments()).toEqual({ environmentId: 'env', environments })
    expect(mocks.list).toHaveBeenCalledWith({ includeDescriptors: true })
  })
  it.each([null, {}, [], { environmentId: 'env' }, { environmentId: 'env', sessionId: '../s' }, { environmentId: 1, sessionId: 's' }])('rejects malformed references before environment access: %j', async ref => {
    mocks.target.mockClear()
    await expect(readPhoneSessionLinkTarget(ref)).rejects.toMatchObject({ code: 'invalid_argument' })
    expect(mocks.target).not.toHaveBeenCalled()
  })
  it('validates the complete metadata batch before calling its projection', async () => {
    mocks.metadata.mockClear()
    await expect(readPhoneSessionLinkMetadata([{ environmentId: 'env', sessionId: 's' }, null])).rejects.toMatchObject({ code: 'invalid_argument' })
    await expect(readPhoneSessionLinkMetadata(Array(51).fill({ environmentId: 'env', sessionId: 's' }))).rejects.toMatchObject({ code: 'invalid_argument' })
    expect(mocks.metadata).not.toHaveBeenCalled()
    mocks.metadata.mockResolvedValue([])
    expect(await readPhoneSessionLinkMetadata([{ environmentId: 'env', sessionId: 's', unrelated: 'discarded' }])).toEqual({ metadata: [] })
    expect(mocks.metadata).toHaveBeenCalledWith([{ environmentId: 'env', sessionId: 's' }])
  })
})
