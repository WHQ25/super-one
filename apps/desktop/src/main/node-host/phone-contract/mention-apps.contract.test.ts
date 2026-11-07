import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ControlLease } from '@superone/shared/environment'

const authorize = vi.hoisted(() => vi.fn())
vi.mock('../../mcp/superone-mcp-server', () => ({
  authorizeMentionedMiniApps: async (ids: string[], project: string, session: string, assertControl: () => void) => {
    assertControl()
    const result = await authorize(ids, project, session)
    assertControl()
    return result
  },
}))
vi.mock('../../logger', () => ({ default: { info() {}, warn() {}, debug() {}, error() {} } }))
import { connectPhone, phoneDomain } from '../phone-endpoint-test-fixtures'
const cleanup: Array<() => void> = []
afterEach(() => { while (cleanup.length) cleanup.pop()!(); authorize.mockReset() })

describe('session host mention grants', () => {
  it('authorizes apps on the owning node after session control admission', async () => {
    const { domain, projectDir } = phoneDomain(cleanup)
    const phone = await connectPhone(domain)
    cleanup.push(phone.close)
    const lease = await phone.rpc<ControlLease>('session.acquireControl', { sessionId: 'own' })
    const apps = { miniappIds: ['board'], desktopApps: [] }
    await expect(phone.rpc('session.authorizeMentionApps', { sessionId: 'own', ...apps })).rejects.toBeDefined()
    expect(authorize).not.toHaveBeenCalled()
    authorize.mockResolvedValue(['board'])
    expect(await phone.rpc('session.authorizeMentionApps', {
      sessionId: 'own', leaseId: lease.leaseId, generation: lease.generation, ...apps,
    })).toEqual({ miniappIds: ['board'], desktopAppsGranted: false })
    expect(authorize).toHaveBeenCalledExactlyOnceWith(['board'], projectDir, 'own')
  })
})
