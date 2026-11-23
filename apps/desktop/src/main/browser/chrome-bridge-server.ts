import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { createServer, type Socket } from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import { resolveSuperoneHome } from '@superone/runtime/fs/superone-home'
import { extensionConnectionBrowser } from '@superone/shared/chrome-extension-browsers'
import type { ChromeBridgeAuth, ChromeBridgeVariant } from '@superone/shared/chrome-bridge-protocol'
import { bindChromeBridge, setChromeDownloadDir } from './chrome-browser'
import { chromeBridgeHub } from './chrome-bridge-hub'
import { installChromeExtension } from './chrome-extension-install'
import { installChromeNativeHost } from './chrome-native-host'
import log from '../logger'
import { variant, variantId } from '../variant'

const FRAME_MAX = 64 * 1024 * 1024

function tokenPath(home: string): string {
  return join(home, 'chrome-bridge.token')
}

export function chromeBridgeSocketPath(home: string, platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') {
    const hash = createHash('sha256').update(home.toLowerCase()).digest('hex').slice(0, 16)
    return `\\\\.\\pipe\\superone-chrome-bridge-${hash}`
  }
  return join(home, 'chrome-bridge.sock')
}

export function readOrCreateChromeBridgeToken(home: string): string {
  const path = tokenPath(home)
  mkdirSync(home, { recursive: true })
  if (existsSync(path)) return readFileSync(path, 'utf8').trim()
  const token = randomBytes(32).toString('hex')
  writeFileSync(path, token, { mode: 0o600 })
  chmodSync(path, 0o600)
  return token
}

function encodeFrame(json: string): Buffer {
  const body = Buffer.from(json)
  const header = Buffer.alloc(4)
  header.writeUInt32LE(body.length, 0)
  return Buffer.concat([header, body])
}

function sameToken(expected: string, received: string): boolean {
  const a = Buffer.from(expected)
  const b = Buffer.from(received)
  return a.length === b.length && timingSafeEqual(a, b)
}

function consumeFrames(buffer: Buffer<ArrayBuffer>, onJson: (json: string) => void): Buffer<ArrayBuffer> {
  let offset = 0
  while (buffer.length - offset >= 4) {
    const length = buffer.readUInt32LE(offset)
    if (length <= 0 || length > FRAME_MAX) throw new Error('Chrome bridge frame is invalid')
    if (buffer.length - offset < 4 + length) break
    onJson(buffer.toString('utf8', offset + 4, offset + 4 + length))
    offset += 4 + length
  }
  if (offset === 0) return buffer
  const rest = Buffer.allocUnsafe(buffer.length - offset)
  buffer.copy(rest, 0, offset)
  return rest
}

function hostScriptPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'chrome-native-host', 'host.mjs')
    : join(app.getAppPath(), 'resources', 'chrome-native-host', 'host.mjs')
}

function extensionSourcePath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'chrome-extension')
    : join(app.getAppPath(), '..', 'chrome-extension')
}

function extensionIconPath(): string {
  const variantName = variantId()
  return app.isPackaged
    ? join(process.resourcesPath, 'icons', `${variantName}.png`)
    : join(app.getAppPath(), variant().icon)
}

export function chromeBridgeHome(variantName: ChromeBridgeVariant, userHome = homedir()): string {
  return resolveSuperoneHome({ userHome, variant: variantName, ignoreEnv: true })
}

export function startChromeBridge(): void {
  const variantName = variantId()
  const userHome = app.getPath('home')
  const home = chromeBridgeHome(variantName, userHome)
  const token = readOrCreateChromeBridgeToken(home)
  const downloads = join(home, 'chrome-downloads')
  mkdirSync(downloads, { recursive: true })
  setChromeDownloadDir(downloads)
  bindChromeBridge(chromeBridgeHub, { downloadDir: downloads })
  const sock = chromeBridgeSocketPath(home)
  if (process.platform !== 'win32' && existsSync(sock)) {
    try { unlinkSync(sock) } catch { /* a live socket is replaced by listen */ }
  }
  const server = createServer((socket) => accept(socket, token))
  server.on('error', (err) => log.warn('[chrome-bridge] socket error: %s', err.message))
  server.listen(sock, () => {
    if (process.platform !== 'win32') {
      try { chmodSync(sock, 0o600) } catch { /* best effort */ }
    }
    log.info('[chrome-bridge] listening')
  })
  try {
    installChromeNativeHost({
      variant: variantName,
      home,
      electronPath: process.execPath,
      hostScript: hostScriptPath(),
    })
  } catch (err) {
    log.warn('[chrome-bridge] native host install failed: %s', err instanceof Error ? err.message : String(err))
  }
  try {
    const extensionDir = installChromeExtension({
      variant: variantName,
      userHome,
      sourceDir: extensionSourcePath(),
      iconPath: extensionIconPath(),
      productName: variant().productName,
      version: app.getVersion(),
      // Stable copies the packaged source. Users load that folder unpacked
      // until a Chrome Web Store listing exists.
      linkSource: variantName !== 'stable',
    })
    log.info('[chrome-bridge] extension ready at %s', extensionDir)
  } catch (err) {
    log.warn('[chrome-bridge] extension install failed: %s', err instanceof Error ? err.message : String(err))
  }
}

function accept(socket: Socket, token: string): void {
  let buffer = Buffer.alloc(0)
  let authed = false
  let generation: number | null = null
  let browserId = 'unknown'
  const fail = (reason: string) => {
    log.warn('[chrome-bridge] %s', reason)
    socket.destroy()
  }
  const detachThis = (reason: string) => {
    if (generation == null) return
    const current = generation
    generation = null
    chromeBridgeHub.detachBrowser(browserId, reason, current)
  }
  socket.on('close', () => detachThis('native host closed'))
  socket.on('error', () => detachThis('native host error'))
  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk])
    try {
      buffer = consumeFrames(buffer, (json) => {
        if (!authed) {
          const parsed = JSON.parse(json) as Partial<ChromeBridgeAuth>
          if (!isChromeBridgeAuth(parsed) || !sameToken(token, parsed.auth)) {
            fail('rejected native host')
            return
          }
          authed = true
          browserId = extensionConnectionBrowser(parsed.browser)
          generation = chromeBridgeHub.attach((message) => {
            if (!socket.destroyed) socket.write(encodeFrame(message))
          }, browserId)
          return
        }
        chromeBridgeHub.receive(json, browserId)
      })
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err))
    }
  })
}

export function isChromeBridgeAuth(value: unknown): value is ChromeBridgeAuth {
  return !!value && typeof (value as ChromeBridgeAuth).auth === 'string' && (value as ChromeBridgeAuth).auth.length > 0
}
