import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ensureIosSimulatorHelper } from './helper-build'

/**
 * A stand-in for `native/ios-simulator-helper`, so the build under test is a shell
 * script this file wrote rather than a two-minute Swift compile. `build.sh` is the
 * only contract that matters here: take an output directory, leave a binary in it.
 */
function fakeSourceRoot(): { root: string; invocations: () => number } {
  const root = mkdtempSync(join(tmpdir(), 'ios-helper-src-'))
  const ledger = join(root, 'invocations')
  mkdirSync(join(root, 'Sources'))
  writeFileSync(join(root, 'Sources', 'main.swift'), '// fake\n')
  // Slow enough that a second caller arriving mid-build is the normal case, not a
  // race the test has to win. The real build is far slower still.
  writeFileSync(join(root, 'build.sh'), [
    '#!/bin/bash',
    `echo x >> ${JSON.stringify(ledger)}`,
    'sleep 0.3',
    'touch "$1/superone-ios-simulator-helper"',
    '',
  ].join('\n'))
  return {
    root,
    invocations: () => (existsSync(ledger) ? readFileSync(ledger, 'utf8').trim().split('\n').length : 0),
  }
}

describe('ensureIosSimulatorHelper', () => {
  const previous = process.env.SUPERONE_IOS_HELPER_SOURCE
  let cacheRoot = ''

  beforeEach(() => { cacheRoot = mkdtempSync(join(tmpdir(), 'ios-helper-cache-')) })
  afterEach(() => {
    if (previous === undefined) delete process.env.SUPERONE_IOS_HELPER_SOURCE
    else process.env.SUPERONE_IOS_HELPER_SOURCE = previous
  })

  it.skipIf(!existsSync('/usr/bin/xcodebuild'))(
    'builds once for callers that arrive together',
    async () => {
      // Attaching to a device and starting the Simulator watcher ask for the helper in
      // the same breath. Two builds into one directory clobber each other's object
      // files -- `input file 'OrientationBridge.o' was modified during the build` --
      // and that failure takes down BOTH callers, so the watcher never starts.
      const source = fakeSourceRoot()
      process.env.SUPERONE_IOS_HELPER_SOURCE = source.root

      const [first, second] = await Promise.all([
        ensureIosSimulatorHelper(cacheRoot),
        ensureIosSimulatorHelper(cacheRoot),
      ])

      expect(first).toBe(second)
      expect(existsSync(first)).toBe(true)
      expect(source.invocations()).toBe(1)
    },
  )

  it.skipIf(!existsSync('/usr/bin/xcodebuild'))(
    'builds over the rubble a killed build left on the cache key',
    async () => {
      // A build that dies partway -- the app quit, the machine slept -- leaves object
      // files and no binary under the key it was claiming. That directory must not
      // become a permanent wall: every later build would find the slot taken and the
      // binary missing, and there would be no way out but deleting it by hand.
      const source = fakeSourceRoot()
      process.env.SUPERONE_IOS_HELPER_SOURCE = source.root
      const rubble = await ensureIosSimulatorHelper(cacheRoot)
      rmSync(rubble)
      expect(existsSync(rubble)).toBe(false)

      const rebuilt = await ensureIosSimulatorHelper(cacheRoot)

      expect(rebuilt).toBe(rubble)
      expect(existsSync(rebuilt)).toBe(true)
      expect(source.invocations()).toBe(2)
    },
  )

  it.skipIf(!existsSync('/usr/bin/xcodebuild'))(
    'reuses the finished build instead of running a second one',
    async () => {
      const source = fakeSourceRoot()
      process.env.SUPERONE_IOS_HELPER_SOURCE = source.root

      const first = await ensureIosSimulatorHelper(cacheRoot)
      const second = await ensureIosSimulatorHelper(cacheRoot)

      expect(second).toBe(first)
      expect(source.invocations()).toBe(1)
    },
  )
})
