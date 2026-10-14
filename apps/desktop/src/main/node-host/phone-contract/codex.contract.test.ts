import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionEnvironmentDescriptor } from '@superone/shared/environment'

vi.mock('../../logger', () => ({ default: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} } }))

import { fakeCodexServices } from '../codex-test-fixtures'
import { connectPhone, phoneDomain } from '../phone-endpoint-test-fixtures'

const cleanup: Array<() => void> = []
afterEach(() => {
  while (cleanup.length) cleanup.pop()!()
})

describe('phone endpoint: codex', () => {
  it('redeems a reset credit with the node codex contract', async () => {
    const codex = fakeCodexServices()
    const { domain, projectDir } = phoneDomain(cleanup, { codex: codex.services })
    const phone = await connectPhone(domain)
    const { capabilities } = await phone.rpc<ExecutionEnvironmentDescriptor>('environment.descriptor')
    expect(capabilities.methods).toEqual(expect.arrayContaining(['codex.consumeRateLimitReset', 'codex.getRateLimits']))

    expect(await phone.rpc('codex.consumeRateLimitReset', { projectId: 'p1', apiProviderId: null, creditId: 'rc-1' })).toBe('reset')
    expect(codex.service.consumeRateLimitReset).toHaveBeenCalledWith(projectDir, null, 'rc-1')
    await expect(phone.rpc('codex.consumeRateLimitReset', { projectId: 'nope' })).rejects.toMatchObject({ code: 'not_found' })
  })
})
