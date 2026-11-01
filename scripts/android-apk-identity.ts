#!/usr/bin/env bun
/**
 * Read the application id, version name and version code out of an APK, and
 * refuse one that does not match the checkout this workflow is about to tag.
 *
 * The Actions runner has no aapt. The manifest inside an APK is Android's
 * binary XML, so this parses that — and only the manifest entry, not the rest
 * of the archive. A local `eas build --local` APK is not an EAS build record,
 * which is the check the cloud path gets from `build:view`; this is the
 * substitute. It does not inspect the signing certificate. `expo run:android`
 * is a different application id (the dev variant) and fails that way; a binary
 * signed with some other key but stamped with this package still passes and
 * then cannot install over the shipped app.
 *
 *   bun scripts/android-apk-identity.ts --apk superone.apk --profile alpha
 *   bun scripts/android-apk-identity.ts --apk superone.apk --profile internal --github-output "$GITHUB_OUTPUT"
 */

import { createRequire } from 'node:module'
import { inflateRawSync } from 'node:zlib'
import { appendFileSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const RES_STRING_POOL = 0x0001
const RES_XML = 0x0003
const RES_XML_START_ELEMENT = 0x0102
const TYPE_STRING = 0x03
const TYPE_INT_DEC = 0x10
const TYPE_INT_HEX = 0x11
const NO_INDEX = 0xffffffff
const ZIP_LOCAL = 0x04034b50
const ZIP_CENTRAL = 0x02014b50
const ZIP_EOCD = 0x06054b50
const MANIFEST_NAME = 'AndroidManifest.xml'

export const ANDROID_APK_PROFILES = ['alpha', 'internal'] as const
export type AndroidApkProfile = (typeof ANDROID_APK_PROFILES)[number]

export type AndroidManifestIdentity = {
  packageName: string
  versionName: string
  versionCode: number
}

function fail(message: string): never {
  throw new Error(message)
}

function need(buf: Buffer, offset: number, length: number, what: string): void {
  if (offset < 0 || length < 0 || offset + length > buf.length) {
    fail(`APK manifest is truncated while reading ${what}`)
  }
}

function u16(buf: Buffer, offset: number): number {
  need(buf, offset, 2, 'a uint16')
  return buf.readUInt16LE(offset)
}

function u32(buf: Buffer, offset: number): number {
  need(buf, offset, 4, 'a uint32')
  return buf.readUInt32LE(offset)
}

/** UTF-16 and UTF-8 pools. aapt2 2.20 writes UTF-16; both flags occur in the wild. */
function readStringPool(buf: Buffer, offset: number): { strings: string[]; size: number } {
  const type = u16(buf, offset)
  const headerSize = u16(buf, offset + 2)
  const size = u32(buf, offset + 4)
  if (type !== RES_STRING_POOL) fail(`expected a string pool, found chunk type ${type.toString(16)}`)
  need(buf, offset, size, 'the string pool')
  const stringCount = u32(buf, offset + 8)
  const flags = u32(buf, offset + 16)
  const stringsStart = u32(buf, offset + 20)
  const utf8 = (flags & 0x100) !== 0
  const strings: string[] = []
  for (let i = 0; i < stringCount; i++) {
    const start = offset + stringsStart + u32(buf, offset + headerSize + i * 4)
    if (utf8) {
      let p = start
      const utf16Len = buf[p] ?? 0
      p += (utf16Len & 0x80) !== 0 ? 2 : 1
      need(buf, p, 1, 'a utf-8 string length')
      let byteLen = buf[p]!
      if ((byteLen & 0x80) !== 0) {
        need(buf, p + 1, 1, 'a utf-8 string length')
        byteLen = ((byteLen & 0x7f) << 8) | buf[p + 1]!
        p += 2
      } else {
        p += 1
      }
      need(buf, p, byteLen, 'a utf-8 string')
      strings.push(buf.toString('utf8', p, p + byteLen))
    } else {
      let charLen = u16(buf, start)
      let p = start + 2
      if ((charLen & 0x8000) !== 0) {
        charLen = ((charLen & 0x7fff) << 16) | u16(buf, p)
        p += 2
      }
      const byteLen = charLen * 2
      need(buf, p, byteLen, 'a utf-16 string')
      strings.push(buf.toString('utf16le', p, p + byteLen))
    }
  }
  return { strings, size }
}

function stringAt(strings: string[], index: number, what: string): string {
  if (index === NO_INDEX) fail(`Android manifest is missing ${what}`)
  const value = strings[index]
  if (value === undefined) fail(`Android manifest ${what} points at string ${index}, past the pool`)
  return value
}

/**
 * Package, versionName and versionCode from a binary AndroidManifest.xml.
 * The element name and the attribute names are enough; the resource-id map
 * is skipped with the rest of the chunks.
 */
export function readAndroidManifestIdentityFromXml(xml: Buffer): AndroidManifestIdentity {
  if (xml.length < 8 || u16(xml, 0) !== RES_XML) fail('AndroidManifest.xml is not binary Android XML')
  const rootSize = u32(xml, 4)
  need(xml, 0, rootSize, 'the binary XML')
  let offset = u16(xml, 2)
  let strings: string[] | null = null
  while (offset + 8 <= rootSize) {
    const type = u16(xml, offset)
    const headerSize = u16(xml, offset + 2)
    const size = u32(xml, offset + 4)
    if (size < 8) fail('Android manifest chunk has no size')
    need(xml, offset, size, 'a binary XML chunk')
    if (type === RES_STRING_POOL && strings === null) {
      strings = readStringPool(xml, offset).strings
    } else if (type === RES_XML_START_ELEMENT) {
      if (!strings) fail('Android manifest element appears before its string pool')
      const ext = offset + headerSize
      const name = stringAt(strings, u32(xml, ext + 4), 'the element name')
      if (name === 'manifest') {
        const attributeStart = u16(xml, ext + 8)
        const attributeSize = u16(xml, ext + 10)
        const attributeCount = u16(xml, ext + 12)
        if (attributeSize < 20) fail(`Android manifest attribute is ${attributeSize} bytes`)
        const found: Partial<AndroidManifestIdentity> = {}
        for (let i = 0; i < attributeCount; i++) {
          const at = ext + attributeStart + i * attributeSize
          need(xml, at, 20, 'a manifest attribute')
          const attrName = stringAt(strings, u32(xml, at + 4), 'an attribute name')
          const raw = u32(xml, at + 8)
          const dataType = xml[at + 15]!
          const data = u32(xml, at + 16)
          if (attrName === 'package' || attrName === 'versionName') {
            const index = raw !== NO_INDEX ? raw : dataType === TYPE_STRING ? data : NO_INDEX
            const text = stringAt(strings, index, attrName)
            if (attrName === 'package') found.packageName = text
            else found.versionName = text
          } else if (attrName === 'versionCode') {
            if (dataType === TYPE_INT_DEC || dataType === TYPE_INT_HEX) found.versionCode = data
            else if (dataType === TYPE_STRING || raw !== NO_INDEX) {
              const text = stringAt(strings, raw !== NO_INDEX ? raw : data, 'versionCode')
              if (!/^[1-9]\d*$/.test(text)) fail(`versionCode ${text} is not a positive integer`)
              found.versionCode = Number(text)
            } else {
              fail(`versionCode has unsupported type ${dataType.toString(16)}`)
            }
          }
        }
        if (!found.packageName || !found.versionName || found.versionCode === undefined) {
          fail(
            `Android manifest is missing package, versionName or versionCode (got ${JSON.stringify(found)})`,
          )
        }
        if (!Number.isSafeInteger(found.versionCode) || found.versionCode <= 0) {
          fail(`versionCode ${found.versionCode} is not a positive integer`)
        }
        return {
          packageName: found.packageName,
          versionName: found.versionName,
          versionCode: found.versionCode,
        }
      }
    }
    offset += size
  }
  fail('Android manifest has no <manifest> element')
}

function findEocd(apk: Buffer): number {
  if (apk.length < 22) fail('APK is not a zip archive')
  const min = Math.max(0, apk.length - 22 - 0xffff)
  for (let i = apk.length - 22; i >= min; i--) {
    if (u32(apk, i) !== ZIP_EOCD) continue
    const commentLen = u16(apk, i + 20)
    if (i + 22 + commentLen === apk.length) return i
  }
  fail('APK is not a zip archive')
}

function readZipEntry(apk: Buffer, name: string): Buffer {
  const eocd = findEocd(apk)
  const entryCount = u16(apk, eocd + 10)
  const centralSize = u32(apk, eocd + 12)
  const centralOffset = u32(apk, eocd + 16)
  if (entryCount === 0xffff || centralOffset === NO_INDEX || centralSize === NO_INDEX) {
    fail('APK uses Zip64, which this check does not read')
  }
  need(apk, centralOffset, centralSize, 'the zip central directory')
  let offset = centralOffset
  const end = centralOffset + centralSize
  while (offset + 46 <= end) {
    if (u32(apk, offset) !== ZIP_CENTRAL) fail('APK central directory is corrupt')
    const method = u16(apk, offset + 10)
    const compressedSize = u32(apk, offset + 20)
    const nameLen = u16(apk, offset + 28)
    const extraLen = u16(apk, offset + 30)
    const commentLen = u16(apk, offset + 32)
    const localOffset = u32(apk, offset + 42)
    need(apk, offset + 46, nameLen, 'a zip entry name')
    const entryName = apk.toString('utf8', offset + 46, offset + 46 + nameLen)
    if (entryName === name) {
      need(apk, localOffset, 30, 'a zip local header')
      if (u32(apk, localOffset) !== ZIP_LOCAL) fail(`APK entry ${name} has no local header`)
      const localNameLen = u16(apk, localOffset + 26)
      const localExtraLen = u16(apk, localOffset + 28)
      const dataStart = localOffset + 30 + localNameLen + localExtraLen
      need(apk, dataStart, compressedSize, name)
      const compressed = apk.subarray(dataStart, dataStart + compressedSize)
      if (method === 0) return Buffer.from(compressed)
      if (method === 8) return inflateRawSync(compressed)
      fail(`APK entry ${name} uses compression method ${method}`)
    }
    offset += 46 + nameLen + extraLen + commentLen
  }
  fail(`APK does not contain ${name}`)
}

export function readAndroidManifestIdentityFromApk(apk: Buffer): AndroidManifestIdentity {
  return readAndroidManifestIdentityFromXml(readZipEntry(apk, MANIFEST_NAME))
}

/**
 * The package the profile actually installs. Alpha is the only variant with a
 * suffix; `internal` is the stable APK and keeps the id in app.json.
 * `production` is the Play Store AAB, which this path does not publish.
 */
export function expectedAndroidIdentity(
  profile: string,
  root = repoRoot,
): AndroidManifestIdentity {
  if (!ANDROID_APK_PROFILES.includes(profile as AndroidApkProfile)) {
    fail(
      `local APK profile must be ${ANDROID_APK_PROFILES.join(' or ')} (got ${profile || 'none'}). ` +
        'production is the Play Store AAB; the stable APK profile is internal',
    )
  }
  const app = JSON.parse(readFileSync(join(root, 'apps/mobile/app.json'), 'utf8')) as {
    expo: { version: string; android: { package: string }; ios: { bundleIdentifier: string }; name: string }
  }
  const { applyAppVariant } = require(join(root, 'apps/mobile/app-variant.js')) as {
    applyAppVariant: (config: typeof app.expo, env: { APP_VARIANT?: string }) => typeof app.expo
  }
  const { BUILD_CODE } = require(join(root, 'apps/mobile/build-code.js')) as { BUILD_CODE: number }
  const config = applyAppVariant(app.expo, profile === 'alpha' ? { APP_VARIANT: 'alpha' } : {})
  return {
    packageName: config.android.package,
    versionName: config.version,
    versionCode: BUILD_CODE,
  }
}

export function assertAndroidIdentity(
  actual: AndroidManifestIdentity,
  expected: AndroidManifestIdentity,
): void {
  const mismatches: string[] = []
  if (actual.packageName !== expected.packageName) {
    mismatches.push(`package ${actual.packageName} != ${expected.packageName}`)
  }
  if (actual.versionName !== expected.versionName) {
    mismatches.push(`versionName ${actual.versionName} != ${expected.versionName}`)
  }
  if (actual.versionCode !== expected.versionCode) {
    mismatches.push(`versionCode ${actual.versionCode} != ${expected.versionCode}`)
  }
  if (mismatches.length > 0) {
    fail(`APK does not match this checkout: ${mismatches.join('; ')}`)
  }
}

export function assertApkMatchesCheckout(
  apkPath: string,
  profile: string,
  root = repoRoot,
): AndroidManifestIdentity {
  const expected = expectedAndroidIdentity(profile, root)
  const actual = readAndroidManifestIdentityFromApk(readFileSync(apkPath))
  assertAndroidIdentity(actual, expected)
  return actual
}

function take(argv: string[], i: number, flag: string): string {
  const value = argv[i + 1]
  if (!value || value.startsWith('--')) fail(`${flag} needs a value`)
  return value
}

function main(): void {
  const argv = process.argv.slice(2)
  let apk: string | null = null
  let profile: string | null = null
  let githubOutput: string | null = null
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--apk') {
      apk = take(argv, i, arg)
      i++
    } else if (arg === '--profile') {
      profile = take(argv, i, arg)
      i++
    } else if (arg === '--github-output') {
      githubOutput = take(argv, i, arg)
      i++
    } else if (arg === '--help' || arg === '-h') {
      console.log('usage: bun scripts/android-apk-identity.ts --apk <file.apk> --profile <alpha|internal> [--github-output <file>]')
      return
    } else {
      fail(`unknown argument ${arg}`)
    }
  }
  if (!apk || !profile) fail('usage: --apk <file.apk> --profile <alpha|internal>')
  const identity = assertApkMatchesCheckout(apk, profile)
  const lines = [
    `app_version=${identity.versionName}`,
    `build_code=${identity.versionCode}`,
    `package=${identity.packageName}`,
  ]
  console.log(lines.join('\n'))
  if (githubOutput) appendFileSync(githubOutput, `${lines.slice(0, 2).join('\n')}\n`)
}

if (import.meta.main) {
  try {
    main()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(message)
    if (process.env.GITHUB_ACTIONS) console.error(`::error::${message.split('\n')[0]}`)
    process.exit(1)
  }
}
