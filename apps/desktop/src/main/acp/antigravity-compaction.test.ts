import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import {
  antigravityCompactTrigger,
  antigravityManualCompactStart,
  beginAntigravityCompactionTurn,
  createAntigravityCompactionWatch,
  finishAntigravityManualCompaction,
  observeAntigravityCompaction,
  readAntigravityCompactionSteps,
  type AntigravityCompactionStep,
} from './antigravity-compaction'

function step(overrides: Partial<AntigravityCompactionStep> & Pick<AntigravityCompactionStep, 'idx'>): AntigravityCompactionStep {
  return {
    createdAtMs: 1_000,
    completedAtMs: 5_000,
    failed: false,
    preTokens: 200_000,
    postTokens: 14_000,
    ...overrides,
  }
}

describe('antigravity compaction signals', () => {
  it('treats only a /compact prompt as manual', () => {
    expect(antigravityCompactTrigger('/compact')).toBe('manual')
    expect(antigravityCompactTrigger('  /compact keep the auth notes')).toBe('manual')
    expect(antigravityCompactTrigger('/compaction')).toBe('auto')
    expect(antigravityCompactTrigger('/compact-mode')).toBe('auto')
    expect(antigravityCompactTrigger('please compact')).toBe('auto')
  })

  it('primes finished checkpoints as history and emits one auto end later', () => {
    const watch = createAntigravityCompactionWatch()
    const history = step({ idx: 10, completedAtMs: 4_000 })
    beginAntigravityCompactionTurn(watch, [history], 10_000)
    expect(observeAntigravityCompaction(watch, [history])).toEqual([])

    const live = step({
      idx: 20,
      createdAtMs: 20_000,
      completedAtMs: 61_827,
      preTokens: 250_000,
      postTokens: 13_366,
    })
    const events = observeAntigravityCompaction(watch, [history, live])
    expect(events).toEqual([{
      type: 'compact_boundary',
      trigger: 'auto',
      preTokens: 250_000,
      postTokens: 13_366,
      durationMs: 41_827,
    }])
    expect(events.some((event) => event.type === 'status_indicator')).toBe(false)
    expect(observeAntigravityCompaction(watch, [history, live])).toEqual([])
  })

  it('ignores an unfinished or failed checkpoint', () => {
    const watch = createAntigravityCompactionWatch()
    beginAntigravityCompactionTurn(watch, [], 10_000)
    const open = step({ idx: 3, completedAtMs: 0, createdAtMs: 11_000 })
    expect(observeAntigravityCompaction(watch, [open])).toEqual([])
    const failed = step({ idx: 4, failed: true, createdAtMs: 12_000, completedAtMs: 13_000 })
    expect(observeAntigravityCompaction(watch, [open, failed])).toEqual([])
    const done = step({ idx: 3, createdAtMs: 11_000, completedAtMs: 15_000, preTokens: 90, postTokens: 10 })
    expect(observeAntigravityCompaction(watch, [done, failed])).toEqual([{
      type: 'compact_boundary',
      trigger: 'auto',
      preTokens: 90,
      postTokens: 10,
      durationMs: 4_000,
    }])
  })

  it('does not replay history when the first read lands after the turn starts', () => {
    const watch = createAntigravityCompactionWatch()
    beginAntigravityCompactionTurn(watch, null, 50_000)
    expect(watch.primed).toBe(false)
    const old = step({ idx: 1, completedAtMs: 40_000 })
    const live = step({ idx: 2, createdAtMs: 51_000, completedAtMs: 55_000, preTokens: 8, postTokens: 3 })
    expect(observeAntigravityCompaction(watch, null)).toEqual([])
    expect(watch.primed).toBe(false)
    expect(observeAntigravityCompaction(watch, [old, live])).toEqual([{
      type: 'compact_boundary',
      trigger: 'auto',
      preTokens: 8,
      postTokens: 3,
      durationMs: 4_000,
    }])
  })

  it('opens a manual compact on the turn and closes it from the checkpoint row', () => {
    expect(antigravityManualCompactStart()).toEqual([
      { type: 'status_indicator', indicator: 'compacting' },
    ])
    const watch = createAntigravityCompactionWatch()
    const history = step({ idx: 1, completedAtMs: 4_000 })
    beginAntigravityCompactionTurn(watch, [history], 10_000)
    const row = step({
      idx: 2,
      createdAtMs: 10_500,
      completedAtMs: 18_000,
      preTokens: 180_000,
      postTokens: 12_000,
    })
    const events = finishAntigravityManualCompaction(watch, [history, row], 'success', 10_000, 19_000)
    expect(events).toEqual([
      {
        type: 'compact_boundary',
        trigger: 'manual',
        preTokens: 180_000,
        postTokens: 12_000,
        durationMs: 7_500,
      },
      { type: 'status_indicator', indicator: null, compactResult: 'success' },
    ])
    expect(observeAntigravityCompaction(watch, [history, row])).toEqual([])
  })

  it('closes a successful manual compact from the turn clock when the row is not visible yet', () => {
    const watch = createAntigravityCompactionWatch()
    beginAntigravityCompactionTurn(watch, [], 10_000)
    const events = finishAntigravityManualCompaction(watch, [], 'success', 10_000, 14_200)
    expect(events).toEqual([
      { type: 'compact_boundary', trigger: 'manual', preTokens: 0, durationMs: 4_200 },
      { type: 'status_indicator', indicator: null, compactResult: 'success' },
    ])
    const late = step({ idx: 7, createdAtMs: 11_000, completedAtMs: 14_000, preTokens: 50, postTokens: 9 })
    expect(observeAntigravityCompaction(watch, [late])).toEqual([])
    const later = step({ idx: 8, createdAtMs: 30_000, completedAtMs: 31_000, preTokens: 40, postTokens: 8 })
    expect(observeAntigravityCompaction(watch, [late, later])).toEqual([{
      type: 'compact_boundary',
      trigger: 'auto',
      preTokens: 40,
      postTokens: 8,
      durationMs: 1_000,
    }])
  })

  it('clears a cancelled manual compact unless the checkpoint already succeeded', () => {
    const cancelled = createAntigravityCompactionWatch()
    beginAntigravityCompactionTurn(cancelled, [], 10_000)
    const open = step({ idx: 4, createdAtMs: 11_000, completedAtMs: 0 })
    expect(finishAntigravityManualCompaction(cancelled, [open], 'failed', 10_000, 12_000)).toEqual([{
      type: 'status_indicator',
      indicator: null,
      compactResult: 'failed',
      compactError: 'cancelled',
    }])
    const finishedOpen = step({ idx: 4, createdAtMs: 11_000, completedAtMs: 13_000, preTokens: 70, postTokens: 5 })
    expect(observeAntigravityCompaction(cancelled, [finishedOpen])).toEqual([])

    const done = createAntigravityCompactionWatch()
    beginAntigravityCompactionTurn(done, [], 10_000)
    const row = step({ idx: 5, createdAtMs: 10_200, completedAtMs: 12_200, preTokens: 70, postTokens: 5 })
    expect(finishAntigravityManualCompaction(done, [row], 'failed', 10_000, 12_500)[0]).toMatchObject({
      type: 'compact_boundary',
      trigger: 'manual',
      preTokens: 70,
      postTokens: 5,
      durationMs: 2_000,
    })
  })

  it('reports a failed checkpoint row instead of a success divider', () => {
    const watch = createAntigravityCompactionWatch()
    beginAntigravityCompactionTurn(watch, [], 10_000)
    const row = step({ idx: 6, failed: true, createdAtMs: 11_000, completedAtMs: 12_000 })
    expect(finishAntigravityManualCompaction(watch, [row], 'success', 10_000, 12_000)).toEqual([{
      type: 'status_indicator',
      indicator: null,
      compactResult: 'failed',
      compactError: 'Context compaction failed',
    }])
  })

  it('reads pre and post tokens from the planner steps around step 23', () => {
    const root = mkdtempSync(join(tmpdir(), 'agy-compact-'))
    try {
      const sessionId = 'sess_compact'
      const convDir = join(root, 'antigravity', 'profile', 'antigravity-acp', 'conversations')
      mkdirSync(convDir, { recursive: true })
      const db = new Database(join(convDir, `${sessionId}.db`))
      db.exec('CREATE TABLE steps (idx INTEGER PRIMARY KEY, step_type INTEGER, metadata BLOB, step_payload BLOB, error_details BLOB)')

      const encodeLen = (field: number, bytes: Uint8Array): Buffer => {
        const tag = (field << 3) | 2
        const lenBytes: number[] = []
        let v = bytes.length
        while (v >= 0x80) {
          lenBytes.push((v & 0x7f) | 0x80)
          v >>>= 7
        }
        lenBytes.push(v)
        return Buffer.concat([Buffer.from([tag, ...lenBytes]), Buffer.from(bytes)])
      }
      const encodeVarint = (field: number, val: number): Buffer => {
        const tag = (field << 3) | 0
        const bytes = [tag]
        let v = val
        while (v >= 0x80) {
          bytes.push((v & 0x7f) | 0x80)
          v >>>= 7
        }
        bytes.push(v)
        return Buffer.from(bytes)
      }
      const timestamp = (field: number, seconds: number) => encodeLen(field, encodeVarint(1, seconds))
      const usage = (input: number, cache: number, output: number) => encodeLen(9, Buffer.concat([
        encodeVarint(2, input),
        encodeVarint(3, output),
        encodeVarint(5, cache),
      ]))
      const planner = (input: number, cache: number, output: number) => Buffer.concat([
        timestamp(1, 1_700_000_000),
        usage(input, cache, output),
      ])

      const insert = db.prepare('INSERT INTO steps (idx, step_type, metadata, step_payload, error_details) VALUES (?, ?, ?, NULL, NULL)')
      insert.run(1, 15, planner(1_000, 19_000, 70))
      insert.run(2, 23, Buffer.concat([timestamp(1, 1_793_740_800), timestamp(8, 1_793_740_842)]))
      insert.run(3, 15, planner(366, 13_000, 10))
      db.close()

      const steps = readAntigravityCompactionSteps(sessionId, root)
      expect(steps).toEqual([{
        idx: 2,
        createdAtMs: 1_793_740_800_000,
        completedAtMs: 1_793_740_842_000,
        failed: false,
        preTokens: 20_070,
        postTokens: 13_366,
      }])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
