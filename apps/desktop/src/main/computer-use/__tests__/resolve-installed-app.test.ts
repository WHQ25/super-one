import { describe, expect, it } from 'vitest'
import { matchRunningApp } from '../app-identity'
import {
  clearInstalledAppCacheForTests,
  listInstalledApps,
  resolveInstalledApp,
  setInstalledAppsCatalogForTests,
  setInstalledAppsScanForTests,
} from '../resolve-installed-app'

const TEXT_EDIT = {
  app: 'TextEdit',
  bundleId: 'com.apple.TextEdit',
  path: '/System/Applications/TextEdit.app',
  aliases: ['TextEdit', 'com.apple.TextEdit'],
}

const DOUBAO = {
  app: '豆包',
  bundleId: 'com.bot.pc.doubao',
  path: '/Applications/Doubao.app',
  aliases: ['豆包', 'Doubao', 'com.bot.pc.doubao'],
}

describe('matchRunningApp', () => {
  const running = [
    { app: 'Doubao', bundleId: 'com.bot.pc.doubao', pid: 1, frontmost: true },
    { app: 'TextEdit', bundleId: 'com.apple.TextEdit', pid: 2, frontmost: false },
  ]

  it('matches by bundle id and display name', () => {
    expect(matchRunningApp(running, 'com.bot.pc.doubao')?.app).toBe('Doubao')
    expect(matchRunningApp(running, 'TextEdit')?.bundleId).toBe('com.apple.TextEdit')
  })

  it('matches via localized aliases (豆包 → Doubao process)', () => {
    expect(
      matchRunningApp(running, '豆包', ['豆包', 'Doubao', 'com.bot.pc.doubao'])?.bundleId,
    ).toBe('com.bot.pc.doubao')
  })
})

describe('resolveInstalledApp (injected catalog)', () => {
  it('resolves TextEdit by English name and bundle id', async () => {
    clearInstalledAppCacheForTests()
    setInstalledAppsCatalogForTests([TEXT_EDIT])
    const byName = await resolveInstalledApp('TextEdit')
    expect(byName?.bundleId).toBe('com.apple.TextEdit')
    const byId = await resolveInstalledApp('com.apple.TextEdit')
    expect(byId?.path).toBe('/System/Applications/TextEdit.app')
  })

  it('resolves Doubao from Chinese localized display name 豆包', async () => {
    clearInstalledAppCacheForTests()
    setInstalledAppsCatalogForTests([DOUBAO])
    const byEn = await resolveInstalledApp('Doubao')
    expect(byEn?.bundleId).toBe('com.bot.pc.doubao')
    const byZh = await resolveInstalledApp('豆包')
    expect(byZh?.bundleId).toBe('com.bot.pc.doubao')
    expect(byZh?.aliases.some((a) => a.includes('豆包') || a === 'Doubao')).toBe(true)
  })
})

describe('listInstalledApps (async catalog)', () => {
  it('returns apps and coalesces concurrent cold scans onto one result', async () => {
    clearInstalledAppCacheForTests()
    let calls = 0
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    setInstalledAppsScanForTests(async () => {
      calls += 1
      await gate
      return [TEXT_EDIT]
    })

    const first = listInstalledApps()
    const second = listInstalledApps()
    expect(calls).toBe(1)
    release()
    const [a, b] = await Promise.all([first, second])
    expect(a).toBe(b)
    expect(a).toEqual([TEXT_EDIT])
    const cached = await listInstalledApps()
    expect(cached).toBe(a)
    expect(calls).toBe(1)
  })
})
