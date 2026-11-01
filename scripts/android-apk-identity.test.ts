import { deflateRawSync } from 'node:zlib'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  assertAndroidIdentity,
  expectedAndroidIdentity,
  readAndroidManifestIdentityFromApk,
  readAndroidManifestIdentityFromXml,
} from './android-apk-identity'
import { parseLocalApkUrl, stagingTag, STAGING_ASSET_NAME, STAGING_TAG_PREFIX } from './stage-local-android-apk'

const require = createRequire(import.meta.url)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// aapt2 2.20 link of a manifest whose package is the alpha application id,
// versionName 1.0.0 and versionCode 42. UTF-16 string pool, the encoding
// current build-tools write. The live BUILD_CODE is asserted separately so a
// later bump does not invalidate the bytes.
const MANIFEST = readFileSync(join(root, 'scripts/fixtures/aapt2-android-manifest.bin'))
const FIXTURE = {
  packageName: 'com.superone.superone_remote.alpha',
  versionName: '1.0.0',
  versionCode: 42,
}

function zipEntry(name: string, raw: Buffer, method: 0 | 8, gapBeforeCentral = 0): Buffer {
  const payload = method === 8 ? deflateRawSync(raw) : raw
  const nameBuf = Buffer.from(name)
  const local = Buffer.alloc(30 + nameBuf.length)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)
  local.writeUInt16LE(method, 8)
  local.writeUInt32LE(payload.length, 18)
  local.writeUInt32LE(raw.length, 22)
  local.writeUInt16LE(nameBuf.length, 26)
  nameBuf.copy(local, 30)
  const gap = Buffer.alloc(gapBeforeCentral, 0xab)
  const cd = Buffer.alloc(46 + nameBuf.length)
  cd.writeUInt32LE(0x02014b50, 0)
  cd.writeUInt16LE(20, 4)
  cd.writeUInt16LE(20, 6)
  cd.writeUInt16LE(method, 10)
  cd.writeUInt32LE(payload.length, 20)
  cd.writeUInt32LE(raw.length, 24)
  cd.writeUInt16LE(nameBuf.length, 28)
  cd.writeUInt32LE(0, 42)
  nameBuf.copy(cd, 46)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(1, 8)
  eocd.writeUInt16LE(1, 10)
  eocd.writeUInt32LE(cd.length, 12)
  eocd.writeUInt32LE(local.length + payload.length + gap.length, 16)
  return Buffer.concat([local, payload, gap, cd, eocd])
}

describe('Android manifest identity', () => {
  it('reads the aapt2 binary manifest', () => {
    expect(readAndroidManifestIdentityFromXml(MANIFEST)).toEqual(FIXTURE)
  })

  it('reads the manifest out of a stored or deflated APK, including a signing-block gap', () => {
    expect(readAndroidManifestIdentityFromApk(zipEntry('AndroidManifest.xml', MANIFEST, 0))).toEqual(FIXTURE)
    expect(readAndroidManifestIdentityFromApk(zipEntry('AndroidManifest.xml', MANIFEST, 8, 64))).toEqual(FIXTURE)
  })

  it('ignores a decoy entry and refuses an archive without the manifest', () => {
    const decoy = zipEntry('resources.arsc', Buffer.from('nope'), 0)
    expect(() => readAndroidManifestIdentityFromApk(decoy)).toThrow(/does not contain AndroidManifest.xml/)
    expect(() => readAndroidManifestIdentityFromApk(Buffer.from('not a zip'))).toThrow(/not a zip/)
  })

  it('reads a UTF-8 string pool', () => {
    const identity = readAndroidManifestIdentityFromXml(utf8Manifest())
    expect(identity).toEqual({ packageName: 'com.example.app', versionName: '9.9.9', versionCode: 7 })
  })

  it('reports every mismatch and accepts an exact match', () => {
    expect(() => assertAndroidIdentity(FIXTURE, FIXTURE)).not.toThrow()
    expect(() =>
      assertAndroidIdentity(FIXTURE, { ...FIXTURE, packageName: 'com.superone.superone_remote', versionCode: 41 }),
    ).toThrow(/package .*versionCode/)
  })

  it('derives the expected id from app-variant and build-code.js', () => {
    const { applyAppVariant } = require(join(root, 'apps/mobile/app-variant.js')) as {
      applyAppVariant: (config: { android: { package: string }; version: string }, env: { APP_VARIANT?: string }) => {
        android: { package: string }
        version: string
      }
    }
    const { BUILD_CODE } = require(join(root, 'apps/mobile/build-code.js')) as { BUILD_CODE: number }
    const app = JSON.parse(readFileSync(join(root, 'apps/mobile/app.json'), 'utf8')) as {
      expo: { android: { package: string }; version: string }
    }
    const alpha = applyAppVariant(app.expo, { APP_VARIANT: 'alpha' })
    expect(expectedAndroidIdentity('alpha')).toEqual({
      packageName: alpha.android.package,
      versionName: alpha.version,
      versionCode: BUILD_CODE,
    })
    expect(expectedAndroidIdentity('internal').packageName).toBe(app.expo.android.package)
    expect(alpha.android.package).not.toBe(app.expo.android.package)
    expect(() => expectedAndroidIdentity('production')).toThrow(/internal/)
    expect(() => expectedAndroidIdentity('development')).toThrow(/alpha or internal/)
  })
})

describe('local APK url', () => {
  it('accepts a staging draft and an https url', () => {
    const tag = stagingTag(new Date('2026-11-01T14:15:00.000Z'))
    expect(tag).toBe(`${STAGING_TAG_PREFIX}20261101T141500Z`)
    expect(parseLocalApkUrl(`gh-release:${tag}/${STAGING_ASSET_NAME}`)).toEqual({
      kind: 'github-release',
      tag,
      asset: STAGING_ASSET_NAME,
    })
    expect(parseLocalApkUrl('https://example.com/superone.apk')).toEqual({
      kind: 'https',
      url: 'https://example.com/superone.apk',
    })
  })

  it('refuses desktop tags, mobile tags, http, and a non-staging draft', () => {
    expect(() => parseLocalApkUrl('gh-release:v0.76.0-alpha.1/SuperOne.apk')).toThrow(/staging\/android-apk/)
    expect(() => parseLocalApkUrl('gh-release:mobile/android-alpha/v1.0.0-build42/superone.apk')).toThrow(
      /staging\/android-apk/,
    )
    expect(() => parseLocalApkUrl('gh-release:staging/android-apk/not-a-stamp/superone.apk')).toThrow(
      /staging\/android-apk/,
    )
    expect(() => parseLocalApkUrl('http://example.com/a.apk')).toThrow(/https/)
    expect(() => parseLocalApkUrl('/tmp/superone.apk')).toThrow(/https/)
  })

  it('the identity command rejects the Play Store profile before publishing', () => {
    const result = spawnSync(
      'bun',
      ['scripts/android-apk-identity.ts', '--apk', 'missing.apk', '--profile', 'production'],
      { cwd: root, encoding: 'utf8' },
    )
    expect(result.status).not.toBe(0)
    expect(result.stderr).toMatch(/internal/)
  })
})

/** A one-element manifest with a UTF-8 pool, so the flag aapt2 did not use still parses. */
function utf8Manifest(): Buffer {
  const strings = ['manifest', 'package', 'com.example.app', 'versionName', '9.9.9', 'versionCode']
  const encoded = strings.map((value) => Buffer.from([value.length, value.length, ...Buffer.from(value), 0]))
  const data = Buffer.concat(encoded)
  const headerSize = 28
  const offsetsSize = strings.length * 4
  const poolSize = headerSize + offsetsSize + data.length
  const pool = Buffer.alloc(poolSize)
  pool.writeUInt16LE(0x0001, 0)
  pool.writeUInt16LE(headerSize, 2)
  pool.writeUInt32LE(poolSize, 4)
  pool.writeUInt32LE(strings.length, 8)
  pool.writeUInt32LE(0x100, 16) // UTF-8
  pool.writeUInt32LE(headerSize + offsetsSize, 20)
  let cursor = 0
  for (let i = 0; i < encoded.length; i++) {
    pool.writeUInt32LE(cursor, headerSize + i * 4)
    cursor += encoded[i]!.length
  }
  data.copy(pool, headerSize + offsetsSize)

  // ResXMLTree_node (16) + ResXMLTree_attrExt (20) + 3 attributes (20 each) = 96
  const element = Buffer.alloc(96)
  element.writeUInt16LE(0x0102, 0)
  element.writeUInt16LE(16, 2)
  element.writeUInt32LE(96, 4)
  element.writeUInt32LE(0xffffffff, 12) // no comment
  element.writeUInt32LE(0xffffffff, 16) // no namespace
  element.writeUInt32LE(0, 20) // name: manifest
  element.writeUInt16LE(20, 24) // attributeStart
  element.writeUInt16LE(20, 26) // attributeSize
  element.writeUInt16LE(3, 28) // attributeCount
  const attributes: Array<[number, number, number, number]> = [
    [1, 2, 0x03, 2], // package -> string 2
    [3, 4, 0x03, 4], // versionName -> string 4
    [5, 0xffffffff, 0x10, 7], // versionCode int 7, no raw string
  ]
  attributes.forEach(([name, raw, type, dataValue], index) => {
    const at = 16 + 20 + index * 20
    element.writeUInt32LE(0xffffffff, at) // no namespace
    element.writeUInt32LE(name, at + 4)
    element.writeUInt32LE(raw, at + 8)
    element.writeUInt16LE(8, at + 12) // Res_value.size
    element[at + 15] = type
    element.writeUInt32LE(dataValue, at + 16)
  })

  const rootSize = 8 + pool.length + element.length
  const root = Buffer.alloc(8)
  root.writeUInt16LE(0x0003, 0)
  root.writeUInt16LE(8, 2)
  root.writeUInt32LE(rootSize, 4)
  return Buffer.concat([root, pool, element])
}
