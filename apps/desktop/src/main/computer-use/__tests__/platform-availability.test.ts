import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveComputerUseBackend } from '../create-service'
import { isComputerUseSupportedPlatform } from '../tools'
import { VARIANTS, variant } from '../../variant'
import {
  defaultHelperSocketPath,
  helperProcessMatchPatterns,
  installPackagedReleaseHelper,
  installedReleaseHelperAppPath,
  DEV_HELPER_BUNDLE_ID,
  releaseHelperAppName,
  resolveHelperAppPath,
} from '../platform/macos-helper-client'

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

  it('installs the packaged helper outside the host app before resolving it', () => {
    const root = mkdtempSync(join(tmpdir(), 'superone-cu-helper-'))
    tempRoots.push(root)
    const resourcesPath = join(root, 'SuperOne.app', 'Contents', 'Resources')
    const sourcePath = join(
      root,
      'SuperOne.app',
      'Contents',
      'Frameworks',
      `${releaseHelperAppName()}.app`,
    )
    const installRoot = join(root, 'Application Support', variant().dataDirName, 'Computer Use')
    const installedPath = installedReleaseHelperAppPath(installRoot)
    const executable = join(sourcePath, 'Contents', 'MacOS', releaseHelperAppName())
    const plist = join(sourcePath, 'Contents', 'Info.plist')
    const codeResources = join(sourcePath, 'Contents', '_CodeSignature', 'CodeResources')
    mkdirSync(resourcesPath, { recursive: true })
    mkdirSync(join(sourcePath, 'Contents', 'MacOS'), { recursive: true })
    mkdirSync(join(sourcePath, 'Contents', '_CodeSignature'), { recursive: true })
    writeFileSync(executable, 'release-v1')
    writeFileSync(plist, '<plist>v1</plist>')
    writeFileSync(codeResources, 'signature-v1')

    // The nested app is an installation source, never a launchable fallback.
    expect(resolveHelperAppPath({
      preferDev: false,
      resourcesPath,
      installRoot,
    })).toBeNull()

    const first = installPackagedReleaseHelper({
      resourcesPath,
      installRoot,
      stopRunningHelper: false,
    })
    expect(first).toEqual({ appPath: installedPath, sourcePath, updated: true })
    expect(existsSync(installedPath)).toBe(true)
    expect(resolveHelperAppPath({
      preferDev: false,
      resourcesPath,
      installRoot,
    })).toBe(installedPath)

    const unchanged = installPackagedReleaseHelper({
      resourcesPath,
      installRoot,
      stopRunningHelper: false,
    })
    expect(unchanged?.updated).toBe(false)

    writeFileSync(executable, 'release-v2')
    const upgraded = installPackagedReleaseHelper({
      resourcesPath,
      installRoot,
      stopRunningHelper: false,
    })
    expect(upgraded?.updated).toBe(true)
    expect(readFileSync(
      join(installedPath, 'Contents', 'MacOS', releaseHelperAppName()),
      'utf8',
    )).toBe('release-v2')

    expect(installedPath.startsWith(join(root, 'SuperOne.app'))).toBe(false)
  })

  it('isolates development and release helper sockets and process matching', () => {
    expect(defaultHelperSocketPath('dev')).not.toBe(defaultHelperSocketPath('release'))
    expect(defaultHelperSocketPath('dev')).toContain('-dev.sock')
    // The release socket carries the app variant: connectOrLaunch unlinks this
    // path, so a shared one lets the stable and alpha apps tear down each
    // other's listener.
    expect(defaultHelperSocketPath('release')).toContain(`-${variant().downloadPrefix}.sock`)
    expect(helperProcessMatchPatterns('dev')).toEqual([
      'SuperOne Dev Computer Use.app/Contents/MacOS/SuperOne Dev Computer Use',
    ])
    expect(helperProcessMatchPatterns('release')).toEqual([
      `${releaseHelperAppName()}.app/Contents/MacOS/${releaseHelperAppName()}`,
    ])
  })

  it('keeps every variant on a distinct helper name, bundle id and socket', () => {
    // pkill matches on the executable name and the install swap replaces the
    // bundle in place, so two variants sharing either one ping-pong forever.
    const names = Object.values(VARIANTS).map((v) => `${v.productName} Computer Use`)
    const ids = Object.values(VARIANTS).map((v) => v.computerUseBundleId)
    const roots = Object.values(VARIANTS).map((v) => v.dataDirName)
    expect(new Set(names).size).toBe(names.length)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(roots).size).toBe(roots.length)
    expect(ids).not.toContain(DEV_HELPER_BUNDLE_ID)
  })
})
