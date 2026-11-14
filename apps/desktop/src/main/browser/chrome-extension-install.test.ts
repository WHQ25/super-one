import { createHash } from 'node:crypto'
import { lstatSync, mkdtempSync, mkdirSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CHROME_EXTENSIONS, chromeExtensionLabel, chromeExtensionVersion } from '@superone/shared/chrome-bridge-protocol'
import { installChromeExtension, linkDevChromeExtension } from './chrome-extension-install'

function extensionId(publicKey: string): string {
  const digest = createHash('sha256').update(Buffer.from(publicKey, 'base64')).digest()
  return [...digest.subarray(0, 16).toString('hex')].map((char) => String.fromCharCode(97 + Number.parseInt(char, 16))).join('')
}

describe('chrome extension install', () => {
  it('pins each variant to the extension id of its public key', () => {
    for (const identity of Object.values(CHROME_EXTENSIONS)) {
      expect(extensionId(identity.publicKey)).toBe(identity.id)
    }
    expect(new Set(Object.values(CHROME_EXTENSIONS).map((item) => item.id)).size).toBe(3)
  })

  it('stamps the product name, version, host, and variant icon', () => {
    const root = mkdtempSync(join(tmpdir(), 'superone-chrome-ext-'))
    const source = join(root, 'source')
    mkdirSync(join(source, '_locales', 'en'), { recursive: true })
    writeFileSync(join(source, 'manifest.json'), JSON.stringify({
      manifest_version: 3,
      name: '__MSG_extName__',
      version: '0.1.0',
      key: 'source-key',
    }))
    writeFileSync(join(source, 'background.js'), 'connect()\n')
    writeFileSync(join(source, 'package.json'), '{"private":true}\n')
    writeFileSync(join(source, 'icon.png'), 'placeholder')
    writeFileSync(join(source, '_locales', 'en', 'messages.json'), '{}')
    writeFileSync(join(root, 'icon-dev.png'), 'dev-icon-bytes')

    const userHome = join(root, 'user')
    const dest = installChromeExtension({
      variant: 'dev',
      userHome,
      sourceDir: source,
      iconPath: join(root, 'icon-dev.png'),
      productName: 'SuperOne Dev',
      version: '0.81.0-dev.4',
      linkSource: true,
    })

    const manifest = JSON.parse(readFileSync(join(dest, 'manifest.json'), 'utf8')) as { name: string; version: string; key: string }
    expect(dest).toBe(join(userHome, '.superone', 'dev', 'chrome-extension'))
    expect(lstatSync(join(dest, 'manifest.json')).isSymbolicLink()).toBe(false)
    expect(manifest.name).toBe('SuperOne Dev 0.81.0')
    expect(manifest.version).toBe('0.81.0')
    expect(manifest.key).toBe(CHROME_EXTENSIONS.dev.publicKey)
    expect(JSON.parse(readFileSync(join(dest, 'variant.json'), 'utf8'))).toEqual({
      host: 'com.superone.browser_bridge.dev',
      version: '0.81.0',
    })
    expect(readlinkSync(join(dest, 'icon.png'))).toBe(join(root, 'icon-dev.png'))
    expect(readlinkSync(join(dest, 'background.js'))).toBe(join(source, 'background.js'))
    expect(lstatSync(join(dest, '_locales')).isSymbolicLink()).toBe(true)
    expect(() => readFileSync(join(dest, 'package.json'))).toThrow()
  })

  it('copies the stable extension instead of linking the source tree', () => {
    const root = mkdtempSync(join(tmpdir(), 'superone-chrome-ext-stable-'))
    const source = join(root, 'source')
    mkdirSync(source, { recursive: true })
    writeFileSync(join(source, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'x', version: '0.1.0' }))
    writeFileSync(join(source, 'background.js'), 'connect()\n')
    writeFileSync(join(root, 'icon.png'), 'stable-icon')
    const dest = installChromeExtension({
      variant: 'stable',
      userHome: join(root, 'user'),
      sourceDir: source,
      iconPath: join(root, 'icon.png'),
      productName: 'SuperOne',
      version: '0.81.0',
      linkSource: false,
    })
    expect(dest).toBe(join(root, 'user', '.superone', 'chrome-extension'))
    expect(lstatSync(join(dest, 'background.js')).isSymbolicLink()).toBe(false)
    expect(lstatSync(join(dest, 'icon.png')).isSymbolicLink()).toBe(false)
    expect(readFileSync(join(dest, 'icon.png'), 'utf8')).toBe('stable-icon')
  })

  it('retargets the dev extension at the checkout that launched it', () => {
    const root = mkdtempSync(join(tmpdir(), 'superone-chrome-ext-worktree-'))
    const desktop = join(root, 'apps', 'desktop')
    const source = join(root, 'apps', 'chrome-extension')
    mkdirSync(join(desktop, 'build'), { recursive: true })
    mkdirSync(source, { recursive: true })
    writeFileSync(join(desktop, 'package.json'), JSON.stringify({ version: '0.81.0-dev.4' }))
    writeFileSync(join(desktop, 'variants.json'), JSON.stringify({
      dev: { productName: 'SuperOne Dev', icon: 'build/icon-dev.png' },
    }))
    writeFileSync(join(desktop, 'build', 'icon-dev.png'), 'dev-icon')
    writeFileSync(join(source, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'x', version: '0.1.0' }))
    writeFileSync(join(source, 'background.js'), 'connect()\n')

    const userHome = join(root, 'user')
    const dest = linkDevChromeExtension(desktop, userHome)
    expect(dest).toBe(join(userHome, '.superone', 'dev', 'chrome-extension'))
    expect(readlinkSync(join(dest, 'background.js'))).toBe(join(source, 'background.js'))
    expect(readlinkSync(join(dest, 'icon.png'))).toBe(join(desktop, 'build', 'icon-dev.png'))
    const manifest = JSON.parse(readFileSync(join(dest, 'manifest.json'), 'utf8')) as { name: string; version: string }
    expect(manifest).toMatchObject({ name: 'SuperOne Dev 0.81.0', version: '0.81.0' })
  })

  it('builds the banner name from the product name and a numeric version', () => {
    expect(chromeExtensionVersion('1.2.3-alpha.1')).toBe('1.2.3')
    expect(chromeExtensionLabel('SuperOne Alpha', '0.81.0')).toBe('SuperOne Alpha 0.81.0')
    expect(chromeExtensionLabel('SuperOne', '0.81.0')).toBe('SuperOne 0.81.0')
  })
})
