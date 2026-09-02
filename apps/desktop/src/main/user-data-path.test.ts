import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { packagedUserDataPath } from './user-data-path'
import { VARIANTS } from './variant'

describe('packagedUserDataPath', () => {
  it('scopes the profile to the variant data directory', () => {
    expect(packagedUserDataPath({ appData: '/app-data', dataDirName: 'SuperOne' })).toBe(
      join('/app-data', 'SuperOne'),
    )
  })

  it('keeps the side-by-side variants on separate profiles', () => {
    const paths = Object.values(VARIANTS).map((v) =>
      packagedUserDataPath({ appData: '/app-data', dataDirName: v.dataDirName }),
    )
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('nests an explicit instance under the variant profile', () => {
    expect(
      packagedUserDataPath({ appData: '/app-data', dataDirName: 'SuperOne', instance: 'lab' }),
    ).toBe(join('/app-data', 'SuperOne', 'instance-lab'))
  })

  it('ignores a blank instance', () => {
    for (const instance of ['', '   ', null, undefined]) {
      expect(packagedUserDataPath({ appData: '/app-data', dataDirName: 'SuperOne', instance })).toBe(
        join('/app-data', 'SuperOne'),
      )
    }
  })
})
