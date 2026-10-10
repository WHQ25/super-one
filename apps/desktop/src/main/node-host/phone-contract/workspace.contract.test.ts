import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ALL_AUTH_SCOPES, type ExecutionEnvironmentDescriptor } from '@superone/shared/environment'
import { dispatchRpc, type RpcContext } from '@superone/runtime/server'

vi.mock('../../logger', () => ({ default: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} } }))

import { connectPhone, phoneDomain } from '../phone-endpoint-test-fixtures'

const cleanup: Array<() => void> = []
afterEach(() => {
  while (cleanup.length) cleanup.pop()!()
})

describe('phone endpoint: workspace files and Git', () => {
  it('gives phones the workspace files and Git, which controllers do not get', async () => {
    const { domain, projectDir } = phoneDomain(cleanup)
    const phone = await connectPhone(domain)
    writeFileSync(join(projectDir, 'readme.md'), 'hello')
    const listed = await phone.rpc<Array<{ name: string }>>('workspace.listDir', { projectId: 'p1', relativePath: '.' })
    expect(listed.map((e) => e.name)).toContain('readme.md')
    expect(await phone.rpc('git.status', { projectId: 'p1' })).toMatchObject({ isRepo: true })
    const controller = await dispatchRpc('environment.descriptor', {}, { ...domain.rpcContext(), client: { clientSessionId: 'c', scopes: [...ALL_AUTH_SCOPES] } } as RpcContext)
    const methods = (controller.result as ExecutionEnvironmentDescriptor).capabilities.methods
    for (const method of ['workspace.listDir', 'git.status']) expect(methods).not.toContain(method)
  })
})
