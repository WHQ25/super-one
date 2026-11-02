import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { nodePaths } from '../config'
import { createHarnessCatalogNotifier, signalHarnessCatalogChanged } from './harness-catalog-stamp'

describe('harness catalog stamp', () => {
  it('publishes only when the advertised set changes', () => {
    let ids = ['claude']
    const published: string[][] = []
    const notifier = createHarnessCatalogNotifier(() => ids, (next) => published.push([...next]))
    expect(notifier.note()).toBe(false)
    ids = ['acp', 'claude']
    expect(notifier.note()).toBe(true)
    expect(notifier.note()).toBe(false)
    ids = ['claude', 'acp']
    expect(notifier.note()).toBe(false)
    expect(published).toEqual([['acp', 'claude']])
  })

  it('writes a stamp and ignores a node home that cannot be written', () => {
    const dir = mkdtempSync(join(tmpdir(), 'harness-stamp-'))
    try {
      signalHarnessCatalogChanged(dir)
      expect(readFileSync(nodePaths(dir).harnessCatalogStamp, 'utf8').length).toBeGreaterThan(0)
      expect(() => signalHarnessCatalogChanged(join(dir, 'missing', 'node'))).not.toThrow()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})