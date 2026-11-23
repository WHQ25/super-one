import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chromeExtensionIdentity, chromeNativeHostName, type ChromeBridgeVariant } from '@superone/shared/chrome-bridge-protocol'

const WIN32_NATIVE_HOST_KEYS = [
  'Software\\Google\\Chrome\\NativeMessagingHosts',
  'Software\\Chromium\\NativeMessagingHosts',
  'Software\\Microsoft\\Edge\\NativeMessagingHosts',
  'Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts',
  'Software\\The Browser Company\\Arc\\NativeMessagingHosts',
]

export function chromeNativeHostRegistryKeys(name: string): string[] {
  return WIN32_NATIVE_HOST_KEYS.map((subkey) => `HKCU\\${subkey}\\${name}`)
}

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

export function chromeHostWrapperCmd(home: string, electronPath: string, hostScript: string): string {
  return [
    '@echo off',
    'set "ELECTRON_RUN_AS_NODE=1"',
    `set "SUPERONE_HOME=${home}"`,
    `"${electronPath}" "${hostScript}"`,
    '',
  ].join('\r\n')
}

function defaultRegisterWin32(key: string, manifestPath: string): void {
  execFileSync('reg.exe', ['add', key, '/ve', '/t', 'REG_SZ', '/d', manifestPath, '/f'], {
    stdio: 'ignore',
    windowsHide: true,
  })
}

export function installChromeNativeHost(opts: {
  variant: ChromeBridgeVariant
  home: string
  electronPath: string
  hostScript: string
  platform?: NodeJS.Platform
  userHome?: string
  registerWin32?: (key: string, manifestPath: string) => void
}): string {
  const platform = opts.platform ?? process.platform
  const name = chromeNativeHostName(opts.variant)
  mkdirSync(opts.home, { recursive: true })
  if (platform === 'win32') {
    const wrapperPath = join(opts.home, 'chrome-native-host.cmd')
    writeFileSync(wrapperPath, chromeHostWrapperCmd(opts.home, opts.electronPath, opts.hostScript))
    const manifest = chromeNativeHostManifest(name, wrapperPath, chromeExtensionIdentity(opts.variant).id)
    const manifestPath = join(opts.home, `${name}.json`)
    writeFileSync(manifestPath, manifest)
    const register = opts.registerWin32 ?? defaultRegisterWin32
    for (const key of chromeNativeHostRegistryKeys(name)) {
      try {
        register(key, manifestPath)
      } catch {
        // Skip browsers whose registry write fails.
      }
    }
    return wrapperPath
  }
  const wrapperPath = join(opts.home, 'chrome-native-host.sh')
  writeFileSync(wrapperPath, chromeHostWrapperScript(opts.home, opts.electronPath, opts.hostScript), { mode: 0o755 })
  chmodSync(wrapperPath, 0o755)
  const manifest = chromeNativeHostManifest(name, wrapperPath, chromeExtensionIdentity(opts.variant).id)
  const directories = chromeNativeHostDirectories(platform, opts.userHome ?? homedir())
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
