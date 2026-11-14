import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { superoneHomeSegments } from '@superone/runtime/fs/superone-home'
import {
  chromeExtensionIdentity,
  chromeExtensionLabel,
  chromeExtensionVersion,
  chromeNativeHostName,
  type ChromeBridgeVariant,
} from '@superone/shared/chrome-bridge-protocol'

const GENERATED = new Set(['manifest.json', 'variant.json', 'icon.png', 'package.json'])

/** The variant's own home, ignoring SUPERONE_HOME, so Chrome can load each one once. */
export function chromeExtensionDir(variant: ChromeBridgeVariant, userHome = homedir()): string {
  return join(userHome, ...superoneHomeSegments(variant), 'chrome-extension')
}

/**
 * Dev and alpha point at the source tree. The directory itself stays real, so
 * Chrome keeps the loaded path; only the files are links. The manifest, host
 * name, and icon stay as files or links owned by this variant.
 */
export function installChromeExtension(opts: {
  variant: ChromeBridgeVariant
  sourceDir: string
  iconPath: string
  productName: string
  version: string
  linkSource: boolean
  userHome?: string
}): string {
  const dest = chromeExtensionDir(opts.variant, opts.userHome)
  mkdirSync(dest, { recursive: true })
  const sourceEntries = readdirSync(opts.sourceDir).filter((entry) => !GENERATED.has(entry))
  for (const entry of sourceEntries) place(join(opts.sourceDir, entry), join(dest, entry), opts.linkSource)
  for (const existing of readdirSync(dest)) {
    if (existing === 'icon.png' || existing === 'manifest.json' || existing === 'variant.json') continue
    if (!sourceEntries.includes(existing)) rmSync(join(dest, existing), { recursive: true, force: true })
  }
  const version = chromeExtensionVersion(opts.version)
  const sourceManifest = JSON.parse(readFileSync(join(opts.sourceDir, 'manifest.json'), 'utf8')) as Record<string, unknown>
  const manifest = {
    ...sourceManifest,
    name: chromeExtensionLabel(opts.productName, version),
    version,
    key: chromeExtensionIdentity(opts.variant).publicKey,
  }
  writeFileSync(join(dest, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  writeFileSync(join(dest, 'variant.json'), `${JSON.stringify({
    host: chromeNativeHostName(opts.variant),
    version,
  })}\n`)
  place(opts.iconPath, join(dest, 'icon.png'), opts.linkSource)
  return dest
}

/**
 * Point ~/.superone/dev/chrome-extension at this checkout. Dev starts from
 * whichever worktree ran `bun run dev`, so the links cannot stay on a previous tree.
 */
export function linkDevChromeExtension(desktopDir: string, userHome = homedir()): string {
  const pkg = JSON.parse(readFileSync(join(desktopDir, 'package.json'), 'utf8')) as { version?: string }
  const variants = JSON.parse(readFileSync(join(desktopDir, 'variants.json'), 'utf8')) as Record<string, { productName?: string; icon?: string }>
  const dev = variants.dev
  if (!dev?.productName || !dev.icon || !pkg.version) {
    throw new Error(`Dev Chrome extension link needs a version and variants.json dev.productName/icon in ${desktopDir}`)
  }
  return installChromeExtension({
    variant: 'dev',
    userHome,
    sourceDir: join(desktopDir, '..', 'chrome-extension'),
    iconPath: join(desktopDir, dev.icon),
    productName: dev.productName,
    version: pkg.version,
    linkSource: true,
  })
}

function place(src: string, dest: string, link: boolean): void {
  rmSync(dest, { recursive: true, force: true })
  if (link) symlinkSync(src, dest, statSync(src).isDirectory() ? 'dir' : 'file')
  else cpSync(src, dest, { recursive: true })
}
