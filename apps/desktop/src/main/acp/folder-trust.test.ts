import { describe, expect, it } from 'vitest'
import {
  folderTrustDecision,
  parseFolderTrustRequest,
  settleFolderTrust,
} from './folder-trust'

describe('folder trust', () => {
  it('parses the camelCase request', () => {
    expect(parseFolderTrustRequest({
      sessionId: 's1',
      cwd: '/proj',
      workspace: '/proj',
      configKinds: ['rules', 1, 'mcp'],
    })).toEqual({
      sessionId: 's1',
      cwd: '/proj',
      workspace: '/proj',
      configKinds: ['rules', 'mcp'],
    })
  })

  it('trusts only an explicit allow', () => {
    expect(folderTrustDecision(true)).toBe('trust')
    expect(folderTrustDecision(true, 'cancel')).toBe('reject')
    expect(folderTrustDecision(false)).toBe('reject')
  })

  it('rejects a timeout, a throw, and any outcome other than trust', async () => {
    await expect(settleFolderTrust(() => new Promise(() => {}), 5)).resolves.toEqual({ outcome: 'reject' })
    await expect(settleFolderTrust(async () => { throw new Error('dialog failed') }, 1000)).resolves.toEqual({ outcome: 'reject' })
    await expect(settleFolderTrust(async () => 'later', 1000)).resolves.toEqual({ outcome: 'reject' })
    await expect(settleFolderTrust(async () => 'trust', 1000)).resolves.toEqual({ outcome: 'trust' })
  })
})
