import { describe, expect, it } from 'vitest'
import { parseMobileUpdateManifest, type MobileUpdateManifest } from '../packages/shared/src/mobile-updates'
import { buildManifest, parseArgs, resolveMobileUpdatePlan } from './publish-mobile-update'

const REPO_ROOT = '/repo'

function published(buildCode: number, minSupportedBuildCode: number): MobileUpdateManifest {
  return {
    schemaVersion: 1,
    platform: 'android',
    version: '1.0.0',
    buildCode,
    minSupportedBuildCode,
    releasedAt: '2026-09-01T00:00:00.000Z',
  }
}

describe('parseArgs', () => {
  it('requires the artifact each platform actually has', () => {
    expect(() =>
      parseArgs(['--platform', 'android', '--version', '1.0.0', '--build-code', '42'], REPO_ROOT),
    ).toThrow(/--apk is required/)
    expect(() =>
      parseArgs(['--platform', 'ios', '--version', '1.0.0', '--build-code', '42'], REPO_ROOT),
    ).toThrow(/--testflight-url is required/)
  })

  it('rejects a non-integer build code rather than publishing NaN', () => {
    expect(() =>
      parseArgs(
        ['--platform', 'ios', '--version', '1.0.0', '--build-code', 'v42', '--testflight-url', 'x'],
        REPO_ROOT,
      ),
    ).toThrow(/--build-code requires an integer/)
  })

  it('defaults the floor to unset so a publish inherits it', () => {
    const args = parseArgs(
      ['--platform', 'android', '--version', '1.0.0', '--build-code', '42', '--apk', 'a.apk'],
      REPO_ROOT,
    )
    expect(args.minSupportedBuildCode).toBeNull()
    expect(args.upload).toBe(false)
    expect(args.rollback).toBe(false)
  })
})

describe('resolveMobileUpdatePlan', () => {
  it('inherits the published floor when none is requested', () => {
    const plan = resolveMobileUpdatePlan({
      buildCode: 43,
      requestedMinSupportedBuildCode: null,
      current: published(42, 30),
      rollback: false,
    })
    expect(plan.minSupportedBuildCode).toBe(30)
    expect(plan.raisesFloor).toBe(false)
    expect(plan.movesBackwards).toBe(false)
  })

  it('starts from zero when nothing is published yet', () => {
    const plan = resolveMobileUpdatePlan({
      buildCode: 1,
      requestedMinSupportedBuildCode: null,
      current: null,
      rollback: false,
    })
    expect(plan).toMatchObject({
      minSupportedBuildCode: 0,
      previousBuildCode: null,
      raisesFloor: false,
    })
  })

  it('refuses to move latest backwards unless asked', () => {
    expect(() =>
      resolveMobileUpdatePlan({
        buildCode: 41,
        requestedMinSupportedBuildCode: null,
        current: published(42, 30),
        rollback: false,
      }),
    ).toThrow(/does not advance the published 42/)
    // Re-publishing the same build code would leave already-updated clients
    // with a different binary under a version they will never fetch again.
    expect(() =>
      resolveMobileUpdatePlan({
        buildCode: 42,
        requestedMinSupportedBuildCode: null,
        current: published(42, 30),
        rollback: false,
      }),
    ).toThrow(/does not advance/)
  })

  it('allows the documented rollback behind an explicit flag', () => {
    const plan = resolveMobileUpdatePlan({
      buildCode: 41,
      requestedMinSupportedBuildCode: null,
      current: published(42, 30),
      rollback: true,
    })
    expect(plan.movesBackwards).toBe(true)
    expect(plan.buildCode).toBe(41)
  })

  it('flags a floor raise, which is the one move with no client-side way out', () => {
    const plan = resolveMobileUpdatePlan({
      buildCode: 43,
      requestedMinSupportedBuildCode: 43,
      current: published(42, 30),
      rollback: false,
    })
    expect(plan.raisesFloor).toBe(true)
  })

  it('lets the floor be lowered, because that is how a bad gate is undone', () => {
    const plan = resolveMobileUpdatePlan({
      buildCode: 43,
      requestedMinSupportedBuildCode: 10,
      current: published(42, 40),
      rollback: false,
    })
    expect(plan.minSupportedBuildCode).toBe(10)
    expect(plan.raisesFloor).toBe(false)
  })

  it('refuses a floor above the build being published', () => {
    expect(() =>
      resolveMobileUpdatePlan({
        buildCode: 43,
        requestedMinSupportedBuildCode: 44,
        current: published(42, 30),
        rollback: false,
      }),
    ).toThrow(/hard-gate every user onto a build that does not exist/)
    expect(() =>
      resolveMobileUpdatePlan({
        buildCode: 43,
        requestedMinSupportedBuildCode: -1,
        current: null,
        rollback: false,
      }),
    ).toThrow(/must not be negative/)
  })
})

describe('buildManifest', () => {
  const plan = resolveMobileUpdatePlan({
    buildCode: 43,
    requestedMinSupportedBuildCode: 30,
    current: published(42, 30),
    rollback: false,
  })

  it('emits an android manifest the app accepts', () => {
    const manifest = buildManifest({
      platform: 'android',
      version: '1.0.0',
      plan,
      releasedAt: '2026-09-11T00:00:00.000Z',
      artifact: {
        url: 'https://dl.super-one.dev/mobile/android/superone-v1.0.0-build43.apk',
        md5: '0123456789abcdef0123456789abcdef',
        sizeBytes: 1234,
      },
    })
    // The producing and consuming halves have to agree, so assert against the
    // very parser the app runs rather than against a hand-written shape.
    expect(parseMobileUpdateManifest(manifest, 'android')).toEqual(manifest)
  })

  it('emits an ios manifest the app accepts, with no artifact', () => {
    const manifest = buildManifest({
      platform: 'ios',
      version: '1.0.0',
      plan,
      releasedAt: '2026-09-11T00:00:00.000Z',
      testflightUrl: 'https://testflight.apple.com/join/abcd1234',
    })
    expect(manifest.artifact).toBeUndefined()
    expect(parseMobileUpdateManifest(manifest, 'ios')).toEqual(manifest)
  })
})
