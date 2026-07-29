import { describe, expect, it } from 'vitest'
import { matchRunningApp } from '../app-identity'
import {
  clearInstalledAppCacheForTests,
  resolveInstalledApp,
} from '../resolve-installed-app'

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

describe('resolveInstalledApp (macOS live)', () => {
  it('resolves TextEdit by English name and bundle id', async () => {
    if (process.platform !== 'darwin') return
    clearInstalledAppCacheForTests()
    const byName = await resolveInstalledApp('TextEdit')
    expect(byName?.bundleId).toBe('com.apple.TextEdit')
    const byId = await resolveInstalledApp('com.apple.TextEdit')
    expect(byId?.path).toMatch(/TextEdit\.app$/)
  })

  it('resolves Doubao from Chinese localized display name 豆包 when installed', async () => {
    if (process.platform !== 'darwin') return
    clearInstalledAppCacheForTests()
    const byEn = await resolveInstalledApp('Doubao')
    if (!byEn) {
      // App not installed on this machine — skip without failing CI.
      return
    }
    expect(byEn.bundleId).toBe('com.bot.pc.doubao')
    const byZh = await resolveInstalledApp('豆包')
    expect(byZh?.bundleId).toBe('com.bot.pc.doubao')
    expect(byZh?.aliases.some((a) => a.includes('豆包') || a === 'Doubao')).toBe(true)
  }, 20_000)
})
