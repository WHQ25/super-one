import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('bridge/preload shared runtime', () => {
  const runtimeSrc = readFileSync(join(__dirname, '../../../../../packages/shared/src/miniapp-api-runtime.js'), 'utf-8')
  const bridgeSrc = readFileSync(join(__dirname, 'miniapp-bridge.ts'), 'utf-8')
  const preloadSrc = readFileSync(join(__dirname, '../../preload/miniapp-preload.ts'), 'utf-8')

  it('runtime exports createSuperoneApi', () => {
    expect(runtimeSrc).toContain('function createSuperoneApi(transport, version, opts)')
  })

  it('runtime exports startSuperoneResize', () => {
    expect(runtimeSrc).toContain('function startSuperoneResize(transport)')
  })

  it('bridge inlines the shared runtime', () => {
    expect(bridgeSrc).toContain("miniapp-api-runtime.js?raw")
    expect(bridgeSrc).toContain('createSuperoneApi(transport,')
    expect(bridgeSrc).toContain('startSuperoneResize(transport)')
  })

  it('preload imports the shared runtime', () => {
    expect(preloadSrc).toContain("from '@superone/shared/miniapp-api-runtime'")
    expect(preloadSrc).toContain('createSuperoneApi(transport,')
    expect(preloadSrc).toContain('startSuperoneResize(transport)')
  })

  it('neither bridge nor preload defines API methods directly', () => {
    expect(bridgeSrc).not.toContain('superone.fs.')
    expect(bridgeSrc).not.toContain('superone.git.')
    expect(preloadSrc).not.toContain('readFile')
    expect(preloadSrc).not.toContain('bridgeFsCall')
    expect(preloadSrc).not.toContain('bridgeGitCall')
  })
})
