import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { beforeAll, describe, expect, it, vi } from 'vitest'

// vi.hoisted runs before imports, so build the paths from plain strings here
// and create them in beforeAll.
const dirs = vi.hoisted(() => {
  const root = `${process.env.TMPDIR || '/tmp'}/miniapp-expose-${process.pid}`
  return {
    root,
    project: `${root}/project`,
    userApp: `${root}/apps/demo`,
    outside: `${root}/secrets`,
  }
})

vi.mock('./miniapp-service', () => ({
  getAppBasePath: () => dirs.userApp,
  getAppInstallDir: () => dirs.userApp,
  getUserAppDir: () => dirs.userApp,
}))
vi.mock('./miniapp-state', () => ({ peekMiniAppStoragePaths: () => null }))

const { isPathExposableByApp } = await import('./miniapp-path-exposure')

beforeAll(() => {
  for (const dir of [dirs.project, dirs.userApp, dirs.outside]) mkdirSync(dir, { recursive: true })
  writeFileSync(join(dirs.project, 'report.csv'), 'a,b')
  writeFileSync(join(dirs.userApp, 'bundle.js'), '//')
  writeFileSync(join(dirs.outside, 'id_rsa'), 'KEY')
})

describe('paths a mini-app WebView may hand to the OS', () => {
  it('allows a file inside the open project', () => {
    expect(isPathExposableByApp(dirs.project, 'demo', join(dirs.project, 'report.csv'))).toBe(true)
  })

  it("allows a file inside the app's own directory", () => {
    expect(isPathExposableByApp(dirs.project, 'demo', join(dirs.userApp, 'bundle.js'))).toBe(true)
  })

  it('rejects a file outside both — a poisoned CDN script must not drag out a key', () => {
    expect(isPathExposableByApp(dirs.project, 'demo', join(dirs.outside, 'id_rsa'))).toBe(false)
  })

  it('rejects an escape through ..', () => {
    expect(isPathExposableByApp(dirs.project, 'demo', join(dirs.project, '..', 'secrets', 'id_rsa'))).toBe(false)
  })

  it('rejects relative and non-string paths', () => {
    expect(isPathExposableByApp(dirs.project, 'demo', 'report.csv')).toBe(false)
    expect(isPathExposableByApp(dirs.project, 'demo', 123 as unknown as string)).toBe(false)
  })

  it('still scopes to the app when no project is open', () => {
    expect(isPathExposableByApp('', 'demo', join(dirs.userApp, 'bundle.js'))).toBe(true)
    expect(isPathExposableByApp('', 'demo', join(dirs.project, 'report.csv'))).toBe(false)
  })
})
