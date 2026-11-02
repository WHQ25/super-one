import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { nodePaths } from '../config'
import { isHarnessCatalogStamp, watchHarnessCatalogStamp } from './harness-catalog-watch'

describe('isHarnessCatalogStamp', () => {
  it('matches only the stamp file', () => {
    expect(isHarnessCatalogStamp('harness-catalog.stamp')).toBe(true)
    expect(isHarnessCatalogStamp('node/harness-catalog.stamp')).toBe(true)
    expect(isHarnessCatalogStamp('state.sqlite')).toBe(false)
    expect(isHarnessCatalogStamp('state.sqlite-wal')).toBe(false)
    expect(isHarnessCatalogStamp(null)).toBe(false)
  })
})

describe('watchHarnessCatalogStamp', () => {
  it('appends one event when a stamp write changes the advertised set', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'harness-watch-'))
    let ids = ['claude']
    const published: string[][] = []
    const watch = watchHarnessCatalogStamp({
      nodeHome: dir,
      environmentId: 'env-1',
      readIds: () => ids,
      append: (input) => published.push(input.payload.harnessIds),
    })
    try {
      ids = ['acp', 'claude']
      writeFileSync(nodePaths(dir).harnessCatalogStamp, `${Date.now()}\n`)
      const deadline = Date.now() + 1000
      while (published.length === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      expect(published).toEqual([['acp', 'claude']])
      writeFileSync(nodePaths(dir).harnessCatalogStamp, `${Date.now()}\n`)
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(published).toEqual([['acp', 'claude']])
    } finally {
      watch.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('does not read the catalog after close', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'harness-watch-closed-'))
    let reads = 0
    const watch = watchHarnessCatalogStamp({
      nodeHome: dir,
      environmentId: 'env-1',
      readIds: () => {
        reads += 1
        return ['claude']
      },
      append: () => {},
    })
    const opened = reads
    watch.close()
    writeFileSync(nodePaths(dir).harnessCatalogStamp, `${Date.now()}\n`)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(reads).toBe(opened)
    rmSync(dir, { recursive: true, force: true })
  })
})