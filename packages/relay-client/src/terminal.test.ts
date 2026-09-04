import { describe, expect, it } from 'vitest'
import {
  MAX_TERMINAL_SNAPSHOT_CHUNKS,
  MAX_TERMINAL_SNAPSHOT_SETS,
  TerminalAssembler,
} from './terminal'

const snap = {
  terminalId: 't1',
  cwd: '/p',
  title: 'term',
  status: 'running' as const,
  cols: 80,
  rows: 24,
  lastSeq: 3,
  ownerDeviceId: 'desk',
  writableByMe: true,
  subscriberCount: 1,
}

describe('TerminalAssembler', () => {
  it('replaces on a full snapshot', () => {
    const a = new TerminalAssembler()
    expect(a.apply({ type: 'terminal_snapshot', terminalId: 't1', snapshot: snap, ansi: 'hi' })).toEqual([
      { kind: 'replace', ansi: 'hi', snapshot: snap },
    ])
  })

  it('waits for every snapshot chunk then concatenates', () => {
    const a = new TerminalAssembler()
    expect(a.apply({
      type: 'terminal_snapshot_chunk',
      terminalId: 't1',
      snapshotId: 's',
      index: 1,
      total: 2,
      ansi: 'B',
      snapshot: snap,
    })).toEqual([])
    expect(a.apply({
      type: 'terminal_snapshot_chunk',
      terminalId: 't1',
      snapshotId: 's',
      index: 0,
      total: 2,
      ansi: 'A',
    })).toEqual([{ kind: 'replace', ansi: 'AB', snapshot: snap }])
  })

  it('appends output and records owner / exit', () => {
    const a = new TerminalAssembler()
    a.apply({ type: 'terminal_snapshot', terminalId: 't1', snapshot: snap, ansi: '' })
    expect(a.apply({ type: 'terminal_output', terminalId: 't1', data: 'x', fromSeq: 1, toSeq: 1, createdAt: 0 })).toEqual([
      { kind: 'append', data: 'x' },
    ])
    expect(a.apply({ type: 'terminal_owner_changed', terminalId: 't1', ownerDeviceId: 'm', writableByMe: false })).toEqual([
      { kind: 'meta', writableByMe: false, ownerDeviceId: 'm' },
    ])
    expect(a.snapshot?.writableByMe).toBe(false)
    expect(a.apply({ type: 'terminal_exited', terminalId: 't1', exitCode: 0, signal: null })).toEqual([
      { kind: 'exited', exitCode: 0, signal: null },
    ])
  })

  it('drops malformed and inconsistent snapshot chunks', () => {
    const a = new TerminalAssembler()
    const apply = (value: object) => a.apply({ type: 'terminal_snapshot_chunk', terminalId: 't1', ...value })
    expect(apply({ snapshotId: '', index: 0, total: 1, ansi: 'x', snapshot: snap })).toEqual([])
    expect(apply({ snapshotId: 's', index: -1, total: 1, ansi: 'x', snapshot: snap })).toEqual([])
    expect(apply({ snapshotId: 's', index: 1, total: 1, ansi: 'x', snapshot: snap })).toEqual([])
    expect(apply({ snapshotId: 's', index: 0, total: MAX_TERMINAL_SNAPSHOT_CHUNKS + 1, ansi: 'x', snapshot: snap })).toEqual([])
    expect(apply({ snapshotId: 'mixed', index: 0, total: 2, ansi: 'A', snapshot: snap })).toEqual([])
    expect(apply({ snapshotId: 'mixed', index: 1, total: 3, ansi: 'B' })).toEqual([])
    expect(apply({ snapshotId: 'mixed', index: 1, total: 2, ansi: 'B' })).toEqual([])
  })

  it('bounds concurrent incomplete snapshot sets', () => {
    const a = new TerminalAssembler()
    for (let i = 0; i <= MAX_TERMINAL_SNAPSHOT_SETS; i++) {
      a.apply({
        type: 'terminal_snapshot_chunk',
        terminalId: 't1',
        snapshotId: `s${i}`,
        index: 0,
        total: 2,
        ansi: 'A',
        snapshot: snap,
      })
    }
    expect(a.apply({
      type: 'terminal_snapshot_chunk',
      terminalId: 't1',
      snapshotId: 's0',
      index: 1,
      total: 2,
      ansi: 'B',
    })).toEqual([])
  })
})
