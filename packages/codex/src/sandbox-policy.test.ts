import { describe, expect, it } from 'vitest'
import { buildCodexWorkspaceWriteSandboxPolicy, resolveCodexWritableRoots } from './sandbox-policy'

describe('Codex workspace-write sandbox policy', () => {
  it('keeps cwd first, resolves relative roots, and removes duplicates', () => {
    expect(resolveCodexWritableRoots('/workspace/app', [
      '/workspace/shared',
      '../shared',
      '/workspace/app',
    ])).toEqual(['/workspace/app', '/workspace/shared'])
  })

  it('preserves explicit workspace-write options', () => {
    expect(buildCodexWorkspaceWriteSandboxPolicy('/workspace/app', ['/workspace/api'], {
      readOnlyAccess: { type: 'fullAccess' },
      networkAccess: false,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false,
    })).toEqual({
      type: 'workspaceWrite',
      writableRoots: ['/workspace/app', '/workspace/api'],
      readOnlyAccess: { type: 'fullAccess' },
      networkAccess: false,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false,
    })
  })
})
