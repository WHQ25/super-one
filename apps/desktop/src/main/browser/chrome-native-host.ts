import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chromeExtensionIdentity, chromeNativeHostName, type ChromeBridgeVariant } from '@superone/shared/chrome-bridge-protocol'

export function chromeNativeHostManifest(name: string, hostPath: string, extensionId: string): string {
  return JSON.stringify({
    name,
    description: 'SuperOne browser bridge',
    path: hostPath,
    type: 'stdio',
    allowed_origins: [`chrome-extension://${extensionId}/`],
  }, null, 2)
}

export function chromeNativeHostDirectories(platform: NodeJS.Platform, home: string): string[] {
  if (platform === 'darwin') {
    const root = join(home, 'Library', 'Application Support')
    return [
      'Google/Chrome',
      'Google/Chrome Beta',
      'Google/Chrome Canary',
      'Chromium',
      'Microsoft Edge',
      'BraveSoftware/Brave-Browser',
      'Arc',
    ].map((dir) => join(root, dir, 'NativeMessagingHosts'))
  }
  if (platform === 'linux') {
    const root = join(home, '.config')
    return [
      'google-chrome',
      'google-chrome-beta',
      'chromium',
      'microsoft-edge',
      'BraveSoftware/Brave-Browser',
    ].map((dir) => join(root, dir, 'NativeMessagingHosts'))
  }
  return []
}

export function chromeHostWrapperScript(home: string, electronPath: string, hostScript: string): string {
  const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`
  return [
    '#!/bin/sh',
    'export ELECTRON_RUN_AS_NODE=1',
    `export SUPERONE_HOME=${quote(home)}`,
    `exec ${quote(electronPath)} ${quote(hostScript)}`,
    '',
  ].join('\n')
}

export function installChromeNativeHost(opts: {
  variant: ChromeBridgeVariant
  home: string
  electronPath: string
  hostScript: string
  platform?: NodeJS.Platform
  userHome?: string
}): string {
  const name = chromeNativeHostName(opts.variant)
  const wrapperPath = join(opts.home, 'chrome-native-host.sh')
  mkdirSync(opts.home, { recursive: true })
  writeFileSync(wrapperPath, chromeHostWrapperScript(opts.home, opts.electronPath, opts.hostScript), { mode: 0o755 })
  chmodSync(wrapperPath, 0o755)
  const manifest = chromeNativeHostManifest(name, wrapperPath, chromeExtensionIdentity(opts.variant).id)
  const directories = chromeNativeHostDirectories(opts.platform ?? process.platform, opts.userHome ?? homedir())
  for (const dir of directories) {
    try {
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, `${name}.json`), manifest, { mode: 0o644 })
    } catch {
      // A browser that is not installed, or a profile directory we cannot write, is skipped.
    }
  }
  return wrapperPath
}
