import { homedir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  defaultHarnessHomeRoot,
  HARNESS_HOME_DIRNAME,
  resolveHarnessHomeRoot,
  SUPERONE_DIRNAME,
} from './home-path'

describe('defaultHarnessHomeRoot', () => {
  it('is ~/.superone/harness under the user home', () => {
    expect(defaultHarnessHomeRoot('/Users/x')).toBe(
      join('/Users/x', SUPERONE_DIRNAME, HARNESS_HOME_DIRNAME),
    )
    expect(defaultHarnessHomeRoot()).toBe(join(homedir(), '.superone', 'harness'))
  })
})

describe('resolveHarnessHomeRoot', () => {
  const prev = process.env.SUPERONE_HARNESS_HOME

  afterEach(() => {
    if (prev === undefined) delete process.env.SUPERONE_HARNESS_HOME
    else process.env.SUPERONE_HARNESS_HOME = prev
  })

  it('prefers explicit override', () => {
    process.env.SUPERONE_HARNESS_HOME = '/from/env'
    expect(resolveHarnessHomeRoot({ override: '/explicit' })).toBe('/explicit')
  })

  it('uses SUPERONE_HARNESS_HOME when set', () => {
    process.env.SUPERONE_HARNESS_HOME = '/lab/harness'
    expect(resolveHarnessHomeRoot()).toBe('/lab/harness')
  })

  it('falls back to ~/.superone/harness', () => {
    delete process.env.SUPERONE_HARNESS_HOME
    expect(resolveHarnessHomeRoot({ userHome: '/home/u' })).toBe(
      join('/home/u', '.superone', 'harness'),
    )
  })

  it('can ignore env for host-local isolation', () => {
    process.env.SUPERONE_HARNESS_HOME = '/from/env'
    expect(
      resolveHarnessHomeRoot({
        override: '/dev-data/harness',
        ignoreEnv: true,
      }),
    ).toBe('/dev-data/harness')
  })
})
