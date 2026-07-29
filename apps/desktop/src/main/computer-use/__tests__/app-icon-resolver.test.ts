import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import {
  findAppIcnsPathForTests,
  isSafeBundleId,
} from '../app-icon-resolver'

const fixtures: string[] = []

function makeFakeApp(opts: {
  iconFile: string
  /** Resource entries: file names get empty files; trailing / means directory. */
  resources: string[]
}): string {
  const root = join(
    tmpdir(),
    `superone-icon-fixture-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  )
  fixtures.push(root)
  const contents = join(root, 'Contents')
  const resources = join(contents, 'Resources')
  mkdirSync(resources, { recursive: true })
  writeFileSync(
    join(contents, 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIconFile</key><string>${opts.iconFile}</string>
</dict></plist>
`,
  )
  for (const entry of opts.resources) {
    if (entry.endsWith('/')) {
      mkdirSync(join(resources, entry.slice(0, -1)), { recursive: true })
    } else {
      writeFileSync(join(resources, entry), 'fake-icns')
    }
  }
  return root
}

afterEach(() => {
  for (const root of fixtures.splice(0)) {
    try {
      rmSync(root, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }
})

describe('isSafeBundleId', () => {
  it('accepts reverse-DNS ids', () => {
    expect(isSafeBundleId('com.mitchellh.ghostty')).toBe(true)
    expect(isSafeBundleId('com.apple.TextEdit')).toBe(true)
  })

  it('rejects injection-prone strings', () => {
    expect(isSafeBundleId('com.foo; rm -rf')).toBe(false)
    expect(isSafeBundleId('com.foo "bar"')).toBe(false)
    expect(isSafeBundleId('com.foo/path')).toBe(false)
    expect(isSafeBundleId('')).toBe(false)
  })
})

describe('findAppIcnsPath', () => {
  it('prefers Ghostty.icns over a same-name Resources/ghostty directory', () => {
    // Mirrors Ghostty.app: CFBundleIconFile=Ghostty, Resources/ghostty/ + Ghostty.icns.
    // On case-insensitive APFS, existsSync("…/Ghostty") matches the directory.
    const app = makeFakeApp({
      iconFile: 'Ghostty',
      resources: ['ghostty/', 'Ghostty.icns'],
    })
    const path = findAppIcnsPathForTests(app)
    expect(path).toBe(join(app, 'Contents', 'Resources', 'Ghostty.icns'))
  })

  it('accepts CFBundleIconFile that already includes .icns', () => {
    const app = makeFakeApp({
      iconFile: 'AppIcon.icns',
      resources: ['AppIcon.icns'],
    })
    expect(findAppIcnsPathForTests(app)).toBe(
      join(app, 'Contents', 'Resources', 'AppIcon.icns'),
    )
  })

  it('never returns a directory even if bare icon name matches one', () => {
    const app = makeFakeApp({
      iconFile: 'AppIcon',
      resources: ['AppIcon/'], // only a dir — no .icns
    })
    expect(findAppIcnsPathForTests(app)).toBeNull()
  })
})

describe('Ghostty install (integration)', () => {
  const ghostty = '/Applications/Ghostty.app'
  const hasGhostty = (() => {
    try {
      return require('node:fs').existsSync(ghostty)
    } catch {
      return false
    }
  })()

  it.skipIf(!hasGhostty)('resolves real Ghostty.icns, not Resources/ghostty', () => {
    const path = findAppIcnsPathForTests(ghostty)
    expect(path).toBe(`${ghostty}/Contents/Resources/Ghostty.icns`)
  })
})
