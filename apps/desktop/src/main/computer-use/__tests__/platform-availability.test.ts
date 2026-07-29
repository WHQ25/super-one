import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveComputerUseBackend } from '../create-service'
import { isComputerUseSupportedPlatform } from '../tools'
import { RELEASE_HELPER_APP_NAME, resolveHelperAppPath } from '../platform/macos-helper-client'

const tempRoots: string[] = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('Computer Use platform availability', () => {
  it('supports only macOS in shipped builds', () => {
    expect(isComputerUseSupportedPlatform('darwin')).toBe(true)
    expect(isComputerUseSupportedPlatform('win32')).toBe(false)
    expect(isComputerUseSupportedPlatform('linux')).toBe(false)
  })

  it('fails closed instead of selecting the fake backend outside tests', () => {
    expect(() => resolveComputerUseBackend('auto', {
      platform: 'win32',
      allowTestFake: false,
      helperAvailable: false,
    })).toThrow('only available on macOS')
    expect(() => resolveComputerUseBackend('auto', {
      platform: 'darwin',
      allowTestFake: false,
      helperAvailable: false,
    })).toThrow('helper is not available')
  })

  it('allows the fake backend only when the test path opts in', () => {
    expect(resolveComputerUseBackend('auto', {
      platform: 'linux',
      allowTestFake: true,
      helperAvailable: false,
    })).toBe('fake')
  })

  it('resolves the helper embedded beside packaged Resources', () => {
    const root = mkdtempSync(join(tmpdir(), 'superone-cu-helper-'))
    tempRoots.push(root)
    const resourcesPath = join(root, 'SuperOne.app', 'Contents', 'Resources')
    const helperPath = join(
      root,
      'SuperOne.app',
      'Contents',
      'Frameworks',
      `${RELEASE_HELPER_APP_NAME}.app`,
    )
    mkdirSync(resourcesPath, { recursive: true })
    mkdirSync(helperPath, { recursive: true })

    expect(resolveHelperAppPath({ preferDev: false, resourcesPath })).toBe(helperPath)
  })
})
