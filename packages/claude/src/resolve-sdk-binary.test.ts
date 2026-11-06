import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  packages: new Map<string, string>(),
  files: new Set<string>(),
  lib: [] as string[],
  resolve: vi.fn<(name: string) => string>(),
}))
vi.mock('node:module', () => ({ createRequire: () => ({ resolve: state.resolve }) }))
vi.mock('node:fs', () => ({
  existsSync: (path: unknown) => state.files.has(String(path)),
  readdirSync: () => state.lib,
}))

import { resolveSdkClaudeBinary, resetSdkClaudeBinaryCacheForTests } from './resolve-sdk-binary'

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
const arch = Object.getOwnPropertyDescriptor(process, 'arch')!
const prefix = '@anthropic-ai/claude-agent-sdk-'
const report = (value: unknown) => vi.mocked(process.report.getReport).mockReturnValue(value as ReturnType<typeof process.report.getReport>)
function install(target: string, path = `/sdk/${target}/claude`) {
  state.packages.set(`${prefix}${target}/claude${target.startsWith('win32') ? '.exe' : ''}`, path)
  state.files.add(path)
  return path
}

beforeEach(() => {
  resetSdkClaudeBinaryCacheForTests()
  Object.defineProperty(process, 'platform', { value: 'linux' })
  Object.defineProperty(process, 'arch', { value: 'x64' })
  vi.spyOn(process.report, 'getReport')
  report({ header: { glibcVersionRuntime: '2.36' } })
  state.packages.clear()
  state.files.clear()
  state.lib = []
  state.resolve.mockReset().mockImplementation(name => {
    const path = state.packages.get(name)
    if (!path) throw new Error(`Package not installed: ${name}`)
    return path
  })
})
afterEach(() => {
  Object.defineProperty(process, 'platform', platform)
  Object.defineProperty(process, 'arch', arch)
  vi.restoreAllMocks()
})

describe('bundled Claude native binary selection', () => {
  it('selects glibc when both Linux binary packages are installed', () => {
    const glibc = install('linux-x64')
    install('linux-x64-musl')
    expect(resolveSdkClaudeBinary()).toBe(glibc)
  })

  it('does not mistake an additional musl loader for the running glibc runtime', () => {
    const glibc = install('linux-x64')
    install('linux-x64-musl')
    state.lib = ['ld-musl-x86_64.so.1']
    expect(resolveSdkClaudeBinary()).toBe(glibc)
  })

  it('selects musl when the Linux runtime report has no glibc version', () => {
    report({ header: {} })
    install('linux-x64')
    const musl = install('linux-x64-musl')
    expect(resolveSdkClaudeBinary()).toBe(musl)
  })

  it.each(['glibc', 'musl'])('refuses an incompatible installed package on %s', libc => {
    report({ header: libc === 'glibc' ? { glibcVersionRuntime: '2.36' } : {} })
    install(libc === 'glibc' ? 'linux-x64-musl' : 'linux-x64')
    expect(resolveSdkClaudeBinary()).toBeNull()
  })

  it('uses the Alpine marker when a runtime report is unavailable', () => {
    report(undefined)
    state.files.add('/etc/alpine-release')
    const musl = install('linux-x64-musl')
    install('linux-x64')
    expect(resolveSdkClaudeBinary()).toBe(musl)
  })

  it('uses the musl loader and correct architecture when report collection throws', () => {
    Object.defineProperty(process, 'arch', { value: 'arm64' })
    vi.mocked(process.report.getReport).mockImplementation(() => { throw new Error('report unavailable') })
    state.lib = ['ld-musl-aarch64.so.1']
    install('linux-arm64')
    const musl = install('linux-arm64-musl')
    expect(resolveSdkClaudeBinary()).toBe(musl)
  })

  it('defaults to glibc when report and musl markers are absent', () => {
    report(undefined)
    const glibc = install('linux-x64')
    install('linux-x64-musl')
    expect(resolveSdkClaudeBinary()).toBe(glibc)
  })

  it.each([
    ['darwin', 'arm64', '/app/resources/app.asar/claude', '/app/resources/app.asar.unpacked/claude'],
    ['win32', 'x64', 'C:\\app\\app.asar\\claude.exe', 'C:\\app\\app.asar.unpacked\\claude.exe'],
  ])('preserves %s package naming and asar unpack paths', (os, cpu, packed, unpacked) => {
    Object.defineProperty(process, 'platform', { value: os })
    Object.defineProperty(process, 'arch', { value: cpu })
    install(`${os}-${cpu}`, packed)
    state.files.delete(packed)
    state.files.add(unpacked)
    expect(resolveSdkClaudeBinary()).toBe(unpacked)
    expect(process.report.getReport).not.toHaveBeenCalled()
  })
})
