import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { chromeExtensionIdentity } from '@superone/shared/chrome-bridge-protocol'
import { EXTENSION_BROWSERS } from '@superone/shared/chrome-extension-browsers'
import { chromeHostWrapperScript, chromeNativeHostDirectories, chromeNativeHostManifest, installChromeNativeHost } from './chrome-native-host'

describe('chrome native host install', () => {
  it('names the same application bundles the shared path matcher knows', () => {
    const host = readFileSync(join(import.meta.dirname, '../../../resources/chrome-native-host/host.mjs'), 'utf8')
    for (const browser of EXTENSION_BROWSERS) {
      expect(host).toContain(browser.appFile.toLowerCase())
    }
  })

  it('pins the extension id and the wrapper path in the manifest', () => {
    const manifest = JSON.parse(chromeNativeHostManifest('com.superone.browser_bridge.dev', '/tmp/host.sh', chromeExtensionIdentity('dev').id))
    expect(manifest.allowed_origins).toEqual([`chrome-extension://${chromeExtensionIdentity('dev').id}/`])
    expect(manifest.path).toBe('/tmp/host.sh')
    expect(manifest.type).toBe('stdio')
  })

  it('points Chrome profiles at a per-user NativeMessagingHosts directory', () => {
    const dirs = chromeNativeHostDirectories('darwin', '/Users/me')
    expect(dirs).toContain('/Users/me/Library/Application Support/Google/Chrome/NativeMessagingHosts')
    expect(chromeNativeHostDirectories('win32', '/Users/me')).toEqual([])
  })

  it('writes an executable wrapper that exports the SuperOne home', () => {
    const script = chromeHostWrapperScript('/Users/me/.superone/dev', '/Applications/SuperOne Dev.app/Contents/MacOS/SuperOne Dev', '/resources/host.mjs')
    expect(script).toContain("export SUPERONE_HOME='/Users/me/.superone/dev'")
    expect(script).toContain("export ELECTRON_RUN_AS_NODE=1")
    expect(script).toContain("exec '/Applications/SuperOne Dev.app/Contents/MacOS/SuperOne Dev' '/resources/host.mjs'")
  })

  it('installs the manifest under the chosen home, not the real Chrome profile', () => {
    const root = mkdtempSync(join(tmpdir(), 'superone-chrome-host-'))
    const home = join(root, 'superone')
    const userHome = join(root, 'user')
    const wrapper = installChromeNativeHost({
      variant: 'dev',
      home,
      electronPath: '/electron',
      hostScript: '/host.mjs',
      platform: 'darwin',
      userHome,
    })
    const manifest = JSON.parse(readFileSync(join(userHome, 'Library/Application Support/Google/Chrome/NativeMessagingHosts/com.superone.browser_bridge.dev.json'), 'utf8'))
    expect(wrapper).toBe(join(home, 'chrome-native-host.sh'))
    expect(manifest.path).toBe(wrapper)
    expect(manifest.allowed_origins).toEqual([`chrome-extension://${chromeExtensionIdentity('dev').id}/`])
    expect(readFileSync(wrapper, 'utf8')).toContain(`export SUPERONE_HOME='${home}'`)
    installChromeNativeHost({
      variant: 'alpha',
      home: join(home, 'alpha'),
      electronPath: '/electron',
      hostScript: '/host.mjs',
      platform: 'darwin',
      userHome,
    })
    const alpha = JSON.parse(readFileSync(join(userHome, 'Library/Application Support/Google/Chrome/NativeMessagingHosts/com.superone.browser_bridge.alpha.json'), 'utf8'))
    expect(alpha.allowed_origins).toEqual([`chrome-extension://${chromeExtensionIdentity('alpha').id}/`])
  })
})
